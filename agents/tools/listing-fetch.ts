import type { DiscoveredJobListing } from "./job-discovery";
import { fetchPageText, isBlockedPageText, htmlToText } from "./html";
import { logBoardInfo, logBoardWarn } from "./job-board-log";
import { toGuestLinkedInJobUrl } from "@/lib/job-search/linkedin-urls";
import { supportsPlaywright } from "@/lib/runtime/capabilities";

type Browser = import("playwright").Browser;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function loadChromium() {
  if (!supportsPlaywright()) return null;
  const { chromium } = await import("playwright");
  return chromium;
}

export function buildListingPostingText(
  listing: DiscoveredJobListing,
  detailText: string
): string {
  const parts = [
    `Title: ${listing.title}`,
    `Company: ${listing.company}`,
    `Location: ${listing.location ?? "unknown"}`,
    `Source: ${listing.platform}`,
    `URL: ${listing.url}`,
    "",
  ];

  if (detailText.trim().length > 100) {
    parts.push("JOB POSTING:", detailText.trim());
  }

  if (listing.snippet?.trim()) {
    parts.push("", "SEARCH RESULT SUMMARY:", listing.snippet.trim());
  }

  return parts.join("\n").slice(0, 20000);
}

/**
 * Prefer the actual job brief (role + requirements) over LinkedIn chrome / related jobs.
 * Keeps intro + pulls from requirements/qualifications headings when present.
 */
export function prioritizeListingBrief(text: string, maxChars = 16000): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;

  const markers = [
    /(?:^|\n|\. )\s*(?:requirements?|qualifications?|what you.?ll (?:need|bring|have)|who you are|about the (?:role|job|position)|responsibilities|your profile|you have|must[- ]have|wij vragen|functie-?eisen|wat wij vragen|profiel|eisen)\b/i,
  ];

  let cutAt = -1;
  for (const marker of markers) {
    const match = cleaned.match(marker);
    if (match?.index != null) {
      cutAt = match.index;
      break;
    }
  }

  if (cutAt < 0) {
    // Keep start + end so late requirements aren't lost to truncation.
    const head = cleaned.slice(0, Math.floor(maxChars * 0.55));
    const tail = cleaned.slice(-(Math.floor(maxChars * 0.45)));
    return `${head}\n\n[…]\n\n${tail}`;
  }

  const intro = cleaned.slice(0, Math.min(2500, cutAt));
  const fromReqs = cleaned.slice(Math.max(0, cutAt - 80));
  const combined = `${intro}\n\n---\n\n${fromReqs}`;
  return combined.slice(0, maxChars);
}

async function fetchIndeedDetailWithPlaywright(
  browser: Browser,
  url: string
): Promise<string> {
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1366, height: 900 },
    locale: "nl-NL",
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => {
      const selectors = [
        "#jobDescriptionText",
        ".jobsearch-JobComponent-description",
        "[id*='jobDescription']",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        const t = el?.innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (t.length > 200) return t;
      }
      return document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    });
    return text.slice(0, 20000);
  } finally {
    await context.close();
  }
}

async function fetchLinkedInDetailWithPlaywright(
  browser: Browser,
  url: string
): Promise<string> {
  const guestUrl = toGuestLinkedInJobUrl(url);
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
    },
  });
  const page = await context.newPage();
  try {
    logBoardInfo("linkedin", `Fetching job detail via Playwright`, { url: guestUrl });
    await page.goto(guestUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    // Expand truncated description ("Show more" / "Meer weergeven").
    const showMoreSelectors = [
      "button.show-more-less-html__button",
      'button[aria-label*="more" i]',
      'button:has-text("Show more")',
      'button:has-text("Meer weergeven")',
      'button:has-text("See more")',
    ];
    for (const selector of showMoreSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1200 })) {
          await button.click({ timeout: 2000 });
          await page.waitForTimeout(700);
        }
      } catch {
        // ignore
      }
    }

    const extracted = await page.evaluate(() => {
      function stripHtml(html: string): string {
        const div = document.createElement("div");
        div.innerHTML = html;
        return (div.innerText || div.textContent || "").replace(/\s+/g, " ").trim();
      }

      let jsonLdDescription = "";
      let jsonLdTitle = "";
      let jsonLdCompany = "";
      for (const script of Array.from(
        document.querySelectorAll('script[type="application/ld+json"]')
      )) {
        try {
          const raw = JSON.parse(script.textContent || "null");
          const items = Array.isArray(raw) ? raw : [raw];
          for (const item of items) {
            if (!item || item["@type"] !== "JobPosting") continue;
            jsonLdTitle = String(item.title ?? "");
            jsonLdCompany = String(
              item.hiringOrganization?.name ?? item.hiringOrganization ?? ""
            );
            if (item.description) {
              jsonLdDescription = stripHtml(String(item.description));
            }
          }
        } catch {
          // ignore bad JSON-LD
        }
      }

      const descSelectors = [
        ".description__text .show-more-less-html__markup",
        ".description__text",
        ".show-more-less-html__markup",
        ".jobs-description__content",
        ".jobs-box__html-content",
        "article.jobs-description",
        "[class*='description__text']",
        ".core-section-container__content",
      ];
      let domDescription = "";
      for (const sel of descSelectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        const t = el?.innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (t.length > domDescription.length) domDescription = t;
      }

      const criteria = Array.from(
        document.querySelectorAll(
          ".description__job-criteria-list li, .job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight"
        )
      )
        .map((el) => (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");

      return {
        jsonLdTitle,
        jsonLdCompany,
        jsonLdDescription,
        domDescription,
        criteria,
        bodyLen: document.body?.innerText?.length ?? 0,
      };
    });

    const description =
      extracted.jsonLdDescription.length >= extracted.domDescription.length
        ? extracted.jsonLdDescription
        : extracted.domDescription;

    if (description.length < 200) {
      logBoardWarn("linkedin", `Playwright detail description thin`, {
        url: guestUrl,
        jsonLdChars: extracted.jsonLdDescription.length,
        domChars: extracted.domDescription.length,
        bodyLen: extracted.bodyLen,
      });
      return "";
    }

    const parts = [
      extracted.jsonLdTitle ? `Title: ${extracted.jsonLdTitle}` : "",
      extracted.jsonLdCompany ? `Company: ${extracted.jsonLdCompany}` : "",
      extracted.criteria ? `Job insights:\n${extracted.criteria}` : "",
      "",
      "JOB DESCRIPTION:",
      description,
    ].filter(Boolean);

    const text = parts.join("\n").trim();
    logBoardInfo("linkedin", `Playwright detail extracted`, {
      url: guestUrl,
      chars: text.length,
      source:
        extracted.jsonLdDescription.length >= extracted.domDescription.length
          ? "json-ld"
          : "dom",
    });
    return text.slice(0, 20000);
  } finally {
    await context.close();
  }
}

/**
 * Fetch posting text.
 * Prefer fast HTTP for LinkedIn guest pages; Playwright only when needed.
 * Indeed detail pages are usually bot-blocked — use SERP snippet instead.
 */
export async function fetchListingContent(
  listing: DiscoveredJobListing,
  browser?: Browser | null
): Promise<string> {
  const platformName =
    listing.platform === "indeed"
      ? "indeed"
      : listing.platform === "linkedin"
        ? "linkedin"
        : "linkedin";

  // Indeed view pages almost always return cookie/Cloudflare chrome via Playwright.
  if (listing.platform === "indeed") {
    if (listing.snippet && listing.snippet.length > 80) {
      logBoardInfo("indeed", `Using SERP snippet for matching (skip detail scrape)`, {
        title: listing.title,
        snippetChars: listing.snippet.length,
      });
      return buildListingPostingText(listing, "");
    }
    throw new Error(`No usable posting content for indeed: ${listing.url}`);
  }

  // LinkedIn: HTTP guest page first (fast), Playwright only if thin/blocked.
  if (listing.platform === "linkedin") {
    try {
      const url = toGuestLinkedInJobUrl(listing.url);
      const text = await fetchPageText(url);
      if (!isBlockedPageText(text) && text.length > 400) {
        logBoardInfo("linkedin", `Detail page fetched via HTTP`, {
          url,
          chars: text.length,
        });
        return buildListingPostingText(listing, prioritizeListingBrief(text));
      }
      logBoardWarn(
        "linkedin",
        `HTTP detail thin/blocked (${text.length} chars), trying Playwright`,
        { url }
      );
    } catch (e) {
      logBoardWarn("linkedin", `HTTP detail fetch failed`, e);
    }
  }

  const ownsBrowser =
    !browser && supportsPlaywright() && listing.platform === "linkedin";
  let localBrowser: Browser | null = browser ?? null;

  try {
    if (ownsBrowser) {
      const chromium = await loadChromium();
      if (chromium) {
        localBrowser = await chromium.launch({ headless: true });
      }
    }

    if (listing.platform === "linkedin" && localBrowser) {
      try {
        const playwrightText = await fetchLinkedInDetailWithPlaywright(
          localBrowser,
          listing.url
        );
        if (playwrightText.length > 300 && !isBlockedPageText(playwrightText)) {
          return buildListingPostingText(
            listing,
            prioritizeListingBrief(playwrightText)
          );
        }
      } catch (e) {
        logBoardWarn("linkedin", `Playwright detail fetch failed`, e);
      }
    }

    if (listing.platform !== "linkedin") {
      try {
        const text = await fetchPageText(listing.url);
        if (!isBlockedPageText(text) && text.length > 200) {
          return buildListingPostingText(listing, prioritizeListingBrief(text));
        }
        logBoardWarn(
          platformName,
          `HTTP fetch returned blocked/short content (${text.length} chars)`,
          { url: listing.url }
        );
      } catch (e) {
        logBoardWarn(platformName, `HTTP fetch failed`, e);
      }
    }

    if (listing.snippet && listing.snippet.length > 80) {
      logBoardInfo(platformName, `Using SERP snippet for matching`, {
        title: listing.title,
        snippetChars: listing.snippet.length,
      });
      return buildListingPostingText(listing, "");
    }

    throw new Error(
      `No usable posting content for ${listing.platform}: ${listing.url}`
    );
  } finally {
    if (ownsBrowser && localBrowser) {
      await localBrowser.close().catch(() => undefined);
    }
  }
}

export async function createIndeedBrowser(): Promise<Browser> {
  const chromium = await loadChromium();
  if (!chromium) {
    throw new Error("Playwright is not available in this environment");
  }
  return chromium.launch({ headless: true });
}

/** Shared browser for LinkedIn + Indeed detail fetches. */
export async function createListingBrowser(): Promise<Browser> {
  const chromium = await loadChromium();
  if (!chromium) {
    throw new Error("Playwright is not available in this environment");
  }
  return chromium.launch({ headless: true });
}

export function normalizeIndeedViewJobUrl(
  origin: string,
  jobKey: string
): string {
  return `${origin.replace(/\/$/, "")}/viewjob?jk=${jobKey}`;
}

export function extractIndeedJobKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const jk = parsed.searchParams.get("jk");
    if (jk) return jk;
    const match = url.match(/[?&]jk=([a-z0-9]+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Strip HTML entities leftover from LinkedIn JSON-LD if any. */
export function normalizeFetchedListingHtml(htmlOrText: string): string {
  if (!/[<>]/.test(htmlOrText)) return htmlOrText;
  try {
    return htmlToText(`<html><body>${htmlOrText}</body></html>`);
  } catch {
    return htmlOrText;
  }
}
