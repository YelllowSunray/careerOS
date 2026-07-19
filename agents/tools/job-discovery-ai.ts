import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import {
  normalizeJobListings,
  normalizeListingValidation,
  normalizeRelevanceBatch,
} from "@/lib/gemini/coerce";
import { isBlockedPageText } from "./html";
import { logBoardError, logBoardInfo, logBoardWarn } from "./job-board-log";
import { formatContextForPrompt } from "@/lib/candidate/context";
import {
  inferExperienceLevelFromContext,
  seniorityLabel,
} from "@/lib/job-search/tailored-queries";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { DiscoveredJobListing } from "./job-discovery";
import type { ExperienceLevel } from "@/lib/types";

const listingValidSchema = z.object({
  isJobPosting: z.boolean(),
  reason: z.string(),
});

const relevanceBatchSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      relevant: z.boolean(),
      relevanceScore: z.number(),
    })
  ),
});

/** AI filters raw API listings to those plausibly matching the candidate's profile. */
export async function filterListingsForCandidate(
  listings: DiscoveredJobListing[],
  context: CandidateContext,
  minScore = 55,
  targetLevel?: ExperienceLevel
): Promise<DiscoveredJobListing[]> {
  if (listings.length === 0) return [];

  const candidateBlock = formatContextForPrompt(context, 10000);
  const workPref = context.profile.workPreference;
  const countries = context.profile.preferredCountries.join(", ") || "any";
  const jobPrefs = context.profile.jobPreferences?.trim();
  const level = targetLevel ?? inferExperienceLevelFromContext(context);

  const kept: DiscoveredJobListing[] = [];

  for (let offset = 0; offset < listings.length; offset += 20) {
    const batch = listings.slice(offset, offset + 20);
    const listingBlock = batch
      .map(
        (l, idx) =>
          `[${idx}] ${l.title} @ ${l.company} | ${l.location ?? "unknown"} | tags: ${(l.tags ?? []).join(", ") || "none"}`
      )
      .join("\n");

    try {
      const result = await generateStructured(
        `Score whether each job listing is a plausible match for this candidate.
Use the candidate's resume, portfolio, skills, and experience level.

Return JSON object (not a bare array) with this exact shape:
{
  "results": [
    { "index": 0, "relevant": true, "relevanceScore": 70 }
  ]
}
Use the listing index numbers from LISTINGS below. Include one result per listing.

REJECT (relevant=false, score<40):
- Completely unrelated fields: sales, accounting, office admin, QA rater, medical, legal unless candidate has that background
- Roles clearly above target level ${seniorityLabel(level)} (e.g. Senior/Lead/Principal/Staff/VP/Director/Head of when target is junior or mid)
- Roles clearly below target level (e.g. intern or graduate role for senior+ profiles)
- Roles/employers that conflict with THIS candidate's stated job preferences (interpret their free-text prefs — org/sector, employment type, location, remote)
- When prefs name an org type, reject employers that are clearly a different type even if the work sounds thematically related

ACCEPT (relevant=true, score 55+):
- Job titles and skills align with candidate's actual background
- Title seniority is appropriate for target level: ${seniorityLabel(level)}
- Employer looks compatible with stated job preferences (when prefs exist)

Work preference: ${workPref}
Preferred locations: ${countries}
Target seniority: ${seniorityLabel(level)}
${jobPrefs ? `Job preferences (HARD for this candidate only): ${jobPrefs}` : "No special job preferences — do not filter by sector/org type."}

CANDIDATE:
${candidateBlock}

LISTINGS (use index numbers):
${listingBlock}`,
        relevanceBatchSchema,
        {
          userId: context.userId,
          operation: "listing_relevance",
          coerce: normalizeRelevanceBatch,
        }
      );

      const scoredIndexes = new Set<number>();
      for (const r of result.results) {
        scoredIndexes.add(r.index);
        if (r.relevant && r.relevanceScore >= minScore && batch[r.index]) {
          kept.push(batch[r.index]);
        }
      }
      // Without prefs, keep unscored indexes for full evaluation.
      // With prefs, omit unscored — do not let preference conflicts sneak through.
      if (!jobPrefs) {
        for (let i = 0; i < batch.length; i++) {
          if (!scoredIndexes.has(i)) kept.push(batch[i]);
        }
      }
    } catch (e) {
      console.warn(
        "[Listing relevance] AI filter failed, keeping batch unfiltered:",
        e instanceof Error ? e.message : e
      );
      // Don't stall discovery — evaluate these listings in the next stage.
      kept.push(...batch);
    }
  }

  return kept;
}

/** AI confirms listing text is a real job posting (not cookies/nav/search page). */
export async function validateListingIsJobPosting(
  listing: DiscoveredJobListing,
  postingText: string,
  userId?: string
): Promise<{ isJobPosting: boolean; reason: string }> {
  const platform =
    listing.platform === "linkedin" || listing.platform === "indeed"
      ? listing.platform
      : null;

  if (isBlockedPageText(postingText)) {
    const reason = "Page content looks like cookies, CAPTCHA, or navigation — not a job posting";
    if (platform) logBoardWarn(platform, `Listing rejected (blocked page)`, { title: listing.title, reason });
    return { isJobPosting: false, reason };
  }

  const hasSnippet = (listing.snippet?.trim().length ?? 0) > 80;
  const detailSection = postingText.split("JOB POSTING:")[1]?.split("SEARCH RESULT SUMMARY:")[0]?.trim() ?? "";
  const hasDetail = detailSection.length > 400;

  if (hasDetail) {
    return { isJobPosting: true, reason: "Sufficient full job posting content" };
  }

  if (hasSnippet && listing.title.length > 3) {
    try {
      const result = await generateStructured(
        `Is this a real job posting suitable for candidate matching?
Return isJobPosting=true only if this describes an actual open job role.

LISTING:
Title: ${listing.title}
Company: ${listing.company}
Location: ${listing.location ?? "unknown"}
Platform: ${listing.platform}

CONTENT:
${postingText.slice(0, 8000)}`,
        listingValidSchema,
        {
          userId,
          operation: "listing_validate",
          coerce: normalizeListingValidation,
        }
      );
      if (platform) {
        logBoardInfo(platform, `AI listing validation`, {
          title: listing.title,
          isJobPosting: result.isJobPosting,
          reason: result.reason,
        });
      }
      return result;
    } catch (e) {
      if (platform) logBoardWarn(platform, `AI validation failed, allowing snippet match`, e);
      return { isJobPosting: true, reason: "Validation failed — proceeding with SERP snippet" };
    }
  }

  const reason = "Insufficient job posting content";
  if (platform) logBoardWarn(platform, `Listing rejected`, { title: listing.title, reason });
  return { isJobPosting: false, reason };
}

const listingsSchema = z.preprocess(
  (raw) => normalizeJobListings(raw),
  z.object({
    jobs: z.array(
      z.object({
        title: z.string(),
        company: z.string().optional(),
        url: z.string(),
        location: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
    ),
  })
);

/** AI extracts job listings from a page's text and links. */
export async function extractJobListingsWithAi(
  input: {
    pageUrl: string;
    pageText: string;
    links: { url: string; text: string }[];
    searchQuery?: string;
    platform: DiscoveredJobListing["platform"];
    userId?: string;
  }
): Promise<DiscoveredJobListing[]> {
  const linkSample = input.links
    .filter((l) => l.url.startsWith("http"))
    .slice(0, 80)
    .map((l) => `${l.text.trim().slice(0, 80)} → ${l.url}`)
    .join("\n");

  try {
    const result = await generateStructured(
      `Extract job listings from this web page content using AI analysis.
Return ONLY valid JSON with this exact shape:
{
  "jobs": [
    {
      "title": "job title",
      "company": "company name or Unknown",
      "url": "absolute job detail URL",
      "location": "location if visible",
      "tags": ["optional skill tags"]
    }
  ]
}

Rules:
- Return real job postings only (not navigation, footer, or blog posts)
- Each job must have a title and application/detail URL
- Prefer absolute URLs. If a link is relative, resolve against: ${input.pageUrl}
- If no jobs are found, return { "jobs": [] }
${input.searchQuery ? `- Focus on jobs relevant to: ${input.searchQuery}` : ""}

PAGE URL: ${input.pageUrl}

PAGE TEXT:
${input.pageText.slice(0, 12000)}

LINKS ON PAGE:
${linkSample || "(no links)"}`,
      listingsSchema,
      { userId: input.userId, operation: "job_listing_extract" }
    );

    return result.jobs
      .map((j) => ({
        title: j.title.trim(),
        company: j.company?.trim() || "Unknown",
        url: resolveUrl(j.url, input.pageUrl),
        location: j.location,
        tags: j.tags,
        platform: input.platform,
      }))
      .filter((j) => j.title && j.url.startsWith("http"));
  } catch (e) {
    const board =
      input.platform === "linkedin" || input.platform === "indeed"
        ? input.platform
        : null;
    if (board) {
      logBoardError(board, `AI listing extraction failed`, e);
    } else {
      console.warn("[Job listing extract] AI extraction failed:", e);
    }
    return [];
  }
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString().replace(/\/$/, "");
  } catch {
    return href;
  }
}
