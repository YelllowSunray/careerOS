import { chromium } from "playwright";
import { BROWSER_UA, isLinkedInAuthWall } from "@/lib/job-search/linkedin-urls";
import { launchHeadlessBrowser } from "@/lib/applications/browser-launch";
import { generateStructured } from "@/lib/gemini/client";
import { z } from "zod";
import type { LinkedInProfileData } from "@/lib/types/integrations";
import { nowIso } from "@/lib/utils/dates";

function normalizeLinkedInExtract(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const nullToUndef = (v: unknown) =>
    v == null || v === "" ? undefined : String(v);

  return {
    headline: nullToUndef(o.headline),
    summary: nullToUndef(o.summary),
    skills: Array.isArray(o.skills)
      ? o.skills.map((s) => String(s ?? "").trim()).filter(Boolean)
      : [],
    experience: Array.isArray(o.experience)
      ? o.experience
          .map((e) => {
            const exp = (e ?? {}) as Record<string, unknown>;
            const title = String(exp.title ?? "").trim();
            const company = String(exp.company ?? "").trim();
            if (!title && !company) return null;
            return {
              title: title || "Role",
              company: company || "Unknown",
              description: String(exp.description ?? ""),
            };
          })
          .filter(Boolean)
      : [],
  };
}

const extractSchema = z.preprocess(
  normalizeLinkedInExtract,
  z.object({
    headline: z.string().optional(),
    summary: z.string().optional(),
    skills: z.array(z.string()).default([]),
    experience: z
      .array(
        z.object({
          title: z.string(),
          company: z.string(),
          description: z.string().default(""),
        })
      )
      .default([]),
  })
);

/** Normalize to a canonical public profile URL. */
export function normalizeLinkedInProfileUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProto);
    if (!parsed.hostname.includes("linkedin.com")) return null;
    const match = parsed.pathname.match(/\/in\/([^/?#]+)/i);
    if (!match?.[1]) return null;
    const slug = decodeURIComponent(match[1]).replace(/\/$/, "");
    return `https://www.linkedin.com/in/${slug}/`;
  } catch {
    return null;
  }
}

async function extractProfileFromPage(page: {
  evaluate: (fn: () => unknown) => Promise<unknown>;
}): Promise<{ rawText: string; headline?: string }> {
  const result = (await page.evaluate(() => {
    const main =
      (document.querySelector("main") as HTMLElement | null) ||
      (document.querySelector("#profile-content") as HTMLElement | null) ||
      document.body;

    const headline =
      (
        document.querySelector(".text-body-medium.break-words") as HTMLElement | null
      )?.innerText?.trim() ||
      (document.querySelector("h2") as HTMLElement | null)?.innerText?.trim() ||
      "";

    // Remove obvious chrome.
    const clone = main.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("nav, footer, script, style, aside, [role='navigation']")
      .forEach((el) => el.remove());

    const rawText = (clone.innerText || "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim();

    return { rawText: rawText.slice(0, 25000), headline };
  })) as { rawText: string; headline?: string };

  return result;
}

/**
 * Fetch a LinkedIn /in/ profile using the saved LinkedIn browser session when possible.
 * Falls back to a fresh headless browser (may hit authwall on private profiles).
 */
export async function scrapeLinkedInProfile(
  linkedInUrl: string,
  userId?: string
): Promise<LinkedInProfileData> {
  const url = normalizeLinkedInProfileUrl(linkedInUrl);
  if (!url) {
    return {
      userId: userId ?? "",
      url: linkedInUrl,
      skills: [],
      experience: [],
      status: "failed",
      error: "Invalid LinkedIn profile URL (expected linkedin.com/in/...)",
      fetchedAt: nowIso(),
    };
  }

  let rawText = "";
  let headline: string | undefined;
  let usedSession = false;

  // Prefer persisted LinkedIn session (same as Apply).
  try {
    const session = await launchHeadlessBrowser();
    usedSession = true;
    try {
      await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await session.page.waitForTimeout(2500);

      if (isLinkedInAuthWall(session.page.url())) {
        console.warn(
          "[LinkedIn profile] Auth wall with saved session — sign in via Apply once, then re-analyze"
        );
      } else {
        const extracted = await extractProfileFromPage(session.page);
        rawText = extracted.rawText;
        headline = extracted.headline || undefined;
      }
    } finally {
      await session.close();
    }
  } catch (e) {
    console.warn("[LinkedIn profile] Session browser failed:", e);
  }

  // Guest / ephemeral fallback if session yielded little text.
  if (rawText.length < 400) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent: BROWSER_UA,
        viewport: { width: 1366, height: 900 },
        locale: "en-US",
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);
      if (!isLinkedInAuthWall(page.url())) {
        const extracted = await extractProfileFromPage(page);
        if (extracted.rawText.length > rawText.length) {
          rawText = extracted.rawText;
          headline = extracted.headline || headline;
        }
      }
      await context.close();
    } catch (e) {
      console.warn("[LinkedIn profile] Guest fetch failed:", e);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  if (rawText.length < 200) {
    return {
      userId: userId ?? "",
      url,
      skills: [],
      experience: [],
      status: "failed",
      error: usedSession
        ? "Could not read LinkedIn profile — sign in via Apply once (saves session), then click Re-analyze"
        : "Could not read LinkedIn profile (login wall or empty page)",
      fetchedAt: nowIso(),
      rawText: rawText || undefined,
    };
  }

  let structured: z.infer<typeof extractSchema> | null = null;
  try {
    structured = await generateStructured(
      `Extract structured career data from this LinkedIn profile text.
Only use information present in the text. Do not invent.

Return JSON:
{
  "headline": "string or omit if unknown (never null)",
  "summary": "string About section or omit if unknown (never null)",
  "skills": ["string"],
  "experience": [{ "title": "string", "company": "string", "description": "string" }]
}

LINKEDIN PROFILE TEXT:
${rawText.slice(0, 18000)}`,
      extractSchema,
      { userId, operation: "linkedin_profile_extract" }
    );
  } catch (e) {
    console.warn("[LinkedIn profile] AI extract failed, keeping raw text:", e);
  }

  return {
    userId: userId ?? "",
    url,
    headline: structured?.headline || headline,
    summary: structured?.summary,
    skills: structured?.skills ?? [],
    experience: structured?.experience ?? [],
    rawText,
    status: "complete",
    fetchedAt: nowIso(),
  };
}
