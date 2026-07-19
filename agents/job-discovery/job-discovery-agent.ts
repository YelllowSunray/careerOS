import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import {
  generateTailoredSearchPlan,
  searchJobBoards,
  listingToJobFallback,
  dedupeListings,
  interleaveListingsByPlatform,
  resolveAdzunaCountry,
} from "@/agents/tools/job-discovery";
import { filterListingsForCandidate } from "@/agents/tools/job-discovery-ai";
import { seniorityLabel } from "@/lib/job-search/tailored-queries";
import { discoverJobsFromCareerPages } from "@/agents/tools/job-discovery-career";
import { validateListingIsJobPosting } from "@/agents/tools/job-discovery-ai";
import {
  matchListingToCandidate,
} from "@/agents/tools/job-match";
import {
  isSkillIneligible,
  unmetHardRequirementLabels,
} from "@/lib/job-search/hard-requirements";
import { fetchListingContent } from "@/agents/tools/listing-fetch";
import { searchJobBoardsHttp } from "@/agents/tools/job-discovery-linkedin-guest";
import { saveJob, saveJobMatch, getKnownJobIdentityKeys } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import { listingIdentityKey, stableJobId } from "@/lib/job-search/identity";
import { toGuestLinkedInJobUrl, isLinkedInHostname } from "@/lib/job-search/linkedin-urls";
import { supportsPlaywright } from "@/lib/runtime/capabilities";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { DiscoveredJobListing } from "@/agents/tools/job-discovery";
import { isFindJobsStopped, isWorkflowPaused } from "@/lib/workflows/pause";
import { getPrimaryCountry, effectiveRemotePreference } from "@/lib/job-search/countries";
import { API_JOB_BOARDS, PLAYWRIGHT_JOB_BOARDS, type Job, type JobBoard, type JobMatch } from "@/lib/types";

type ListingBrowser = import("playwright").Browser;

export interface JobDiscoveryInput {
  context: CandidateContext;
  minFitScore?: number;
  workflowId?: string;
  /** Continuous search round (1-based). */
  round?: number;
  /** Listing identity keys already evaluated in this workflow — skip without re-scoring. */
  skipIdentityKeys?: string[];
}

const DEFAULT_BOARDS: JobBoard[] = ["linkedin", "indeed"];
const MAX_LISTINGS_TO_EVALUATE = 20;
const MIN_FIT_TO_SAVE = 50;
/** Parallel detail-fetch + match workers (each still one Gemini match call). */
const EVALUATE_CONCURRENCY = 3;

/** Prefer-full postings when the candidate stated preference constraints. */
function postingTextTooThinForPreferences(text: string): boolean {
  const body = text
    .replace(/^[\s\S]*?JOB POSTING:\s*/i, "")
    .replace(/SEARCH RESULT SUMMARY:[\s\S]*$/i, "")
    .trim();
  return body.length < 500;
}

function looksLikeJobPostingUrl(listing: DiscoveredJobListing): boolean {
  const url = listing.url.toLowerCase();
  return (
    /linkedin\.com\/jobs\//.test(url) ||
    /\/viewjob\?/.test(url) ||
    /[?&]jk=/.test(url) ||
    listing.platform === "linkedin" ||
    listing.platform === "indeed"
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

type EvaluateOutcome =
  | { kind: "matched"; job: Job; match: JobMatch; identityKey: string }
  | { kind: "rejected"; identityKey: string }
  | { kind: "skipped"; identityKey: string };

async function listingsToMatchedJobs(
  listings: DiscoveredJobListing[],
  ctx: AgentContext,
  context: CandidateContext,
  searchTerms: string[],
  fitScoreThreshold: number,
  workflowId?: string,
  skipIdentityKeys: Set<string> = new Set()
): Promise<{
  jobs: Job[];
  matches: JobMatch[];
  evaluated: number;
  rejected: number;
  parseFailures: number;
  skippedKnown: number;
  evaluatedListingKeys: string[];
  paused: boolean;
}> {
  const jobs: Job[] = [];
  const matches: JobMatch[] = [];
  const evaluatedListingKeys: string[] = [];
  let parseFailures = 0;
  let rejected = 0;
  let skippedKnown = 0;

  const knownKeys = await getKnownJobIdentityKeys(ctx.userId);
  console.log(
    `[Job discovery] ${knownKeys.size} jobs already saved — will skip matching for duplicates`
  );

  const hasPrefs = Boolean(context.profile.jobPreferences?.trim());

  let candidates = listings.filter((listing) => {
    const key = listingIdentityKey(listing);
    if (knownKeys.has(key) || skipIdentityKeys.has(key)) {
      skippedKnown++;
      return false;
    }
    return true;
  });

  // Prefer LinkedIn (fuller HTTP guest pages) first.
  candidates.sort((a, b) => {
    const rank = (l: DiscoveredJobListing) =>
      l.platform === "linkedin" ? 0 : l.platform === "indeed" ? 2 : 1;
    return rank(a) - rank(b);
  });

  if (skippedKnown > 0) {
    console.log(
      `[Job discovery] Skipping ${skippedKnown} already-evaluated listings; ${candidates.length} left to score`
    );
  }

  const toScore = candidates.slice(0, MAX_LISTINGS_TO_EVALUATE);
  let listingBrowser: ListingBrowser | null = null;
  const needsBrowserFallback =
    supportsPlaywright() && toScore.some((l) => l.platform === "linkedin");
  if (needsBrowserFallback) {
    try {
      const { createListingBrowser } = await import("@/agents/tools/listing-fetch");
      listingBrowser = await createListingBrowser();
    } catch (e) {
      console.warn("[Job discovery] Shared listing browser unavailable:", e);
    }
  }

  let paused = false;

  try {
    console.log(
      `[Job discovery] Evaluating ${toScore.length} listings (concurrency ${EVALUATE_CONCURRENCY})`
    );

    const outcomes = await mapPool(toScore, EVALUATE_CONCURRENCY, async (listing) => {
      if (workflowId && (await isFindJobsStopped(workflowId))) {
        paused = true;
        return {
          kind: "skipped" as const,
          identityKey: listingIdentityKey(listing),
        };
      }

      const platform = listing.platform ?? "unknown";
      const identityKey = listingIdentityKey(listing);

      try {
        const text = await fetchListingContent(listing, listingBrowser);

        if (!looksLikeJobPostingUrl(listing)) {
          const validation = await validateListingIsJobPosting(
            listing,
            text,
            ctx.userId
          );
          if (!validation.isJobPosting) {
            console.log(
              `[Job discovery] [${platform}] Not a job posting: ${listing.title} — ${validation.reason}`
            );
            return { kind: "rejected" as const, identityKey };
          }
        }

        if (hasPrefs && postingTextTooThinForPreferences(text)) {
          // Soft prefs: thin text is OK — match on title/snippet/skills; prefs are informational.
          console.log(
            `[Job discovery] [${platform}] Thin posting for ${listing.title} @ ${listing.company} — matching without full preference verification`
          );
        }

        let matchResult;
        try {
          matchResult = await matchListingToCandidate(context, listing, text);
        } catch (e) {
          console.warn(
            `[Job discovery] [${platform}] AI match failed for ${listing.url}:`,
            e instanceof Error ? e.message : e
          );
          return { kind: "rejected" as const, identityKey };
        }

        if (matchResult.languageRequirementMet === false) {
          console.log(
            `[Job discovery] [${platform}] Rejected (language): ${listing.title} @ ${listing.company} · requires [${(matchResult.requiredLanguages ?? []).join(", ") || "?"}] — ${matchResult.languageNotes || "candidate missing required language"}`
          );
          return { kind: "rejected" as const, identityKey };
        }

        if (isSkillIneligible(matchResult)) {
          const hardGaps = unmetHardRequirementLabels(matchResult.missingSkills);
          console.log(
            `[Job discovery] [${platform}] Rejected (skills): ${listing.title} @ ${listing.company} · skillRequirementMet=${matchResult.skillRequirementMet} · hard gaps [${hardGaps.join(", ") || "—"}] — ${matchResult.skillNotes || "core skill fit not met"}`
          );
          return { kind: "rejected" as const, identityKey };
        }

        if (matchResult.fitScore < MIN_FIT_TO_SAVE) {
          console.log(
            `[Job discovery] [${platform}] Rejected (${matchResult.fitScore}): ${listing.title} @ ${listing.company} · C${matchResult.contributionScore}/L${matchResult.learningScore}/M${matchResult.moneyScore}${matchResult.preferencesMatch === false ? " [prefs soft-mismatch]" : ""}`
          );
          return { kind: "rejected" as const, identityKey };
        }

        // Skip extra parse Gemini call — listing + fetched text is enough to save.
        const fallback = listingToJobFallback(listing, text, ctx.userId, searchTerms);
        const jobId = stableJobId(ctx.userId, identityKey);
        const rawApplicationUrl = fallback.applicationUrl || listing.url;
        const applicationUrl = isLinkedInHostname(rawApplicationUrl)
          ? toGuestLinkedInJobUrl(rawApplicationUrl)
          : rawApplicationUrl;

        const job: Job = {
          id: jobId,
          userId: ctx.userId,
          title: fallback.title,
          company: fallback.company,
          applicationUrl,
          source: listing.platform === "career_page" ? "career_page" : "job_board",
          sourcePlatform: listing.platform,
          location: fallback.location,
          description: fallback.description,
          requirements: fallback.requirements,
          extractedSkills: fallback.extractedSkills,
          discoveredVia: searchTerms.filter(
            (t) =>
              listing.title.toLowerCase().includes(t.toLowerCase()) ||
              (listing.tags ?? []).some((tag) =>
                tag.toLowerCase().includes(t.toLowerCase())
              )
          ),
          discoveredAt: nowIso(),
          status: "discovered",
        };

        const match: JobMatch = {
          id: `match_${jobId}`,
          userId: ctx.userId,
          jobId,
          fitScore: matchResult.fitScore,
          strengths: matchResult.strengths,
          missingSkills: matchResult.missingSkills,
          applyRecommendation: matchResult.fitScore >= fitScoreThreshold,
          reasoning: matchResult.reasoning,
          preferenceAlignment: matchResult.preferenceAlignment,
          preferencesMatch: matchResult.preferencesMatch,
          contributionScore: matchResult.contributionScore,
          contributionNotes: matchResult.contributionNotes,
          learningScore: matchResult.learningScore,
          learningNotes: matchResult.learningNotes,
          moneyScore: matchResult.moneyScore,
          moneyNotes: matchResult.moneyNotes,
          requiredLanguages: matchResult.requiredLanguages,
          languageRequirementMet: matchResult.languageRequirementMet,
          languageNotes: matchResult.languageNotes,
          skillRequirementMet: matchResult.skillRequirementMet,
          skillNotes: matchResult.skillNotes,
          scopeIncrease: matchResult.scopeIncrease,
          scopeNotes: matchResult.scopeNotes,
          pathType: matchResult.pathType,
          ladderPath: matchResult.ladderPath,
          matchedDestination: matchResult.matchedDestination,
          matchedAt: nowIso(),
        };

        console.log(
          `[Job discovery] [${platform}] Matched (${matchResult.fitScore}): ${job.title} @ ${job.company} · C${matchResult.contributionScore}/L${matchResult.learningScore}/M${matchResult.moneyScore}/S${matchResult.scopeIncrease} · ${matchResult.pathType}${matchResult.preferencesMatch === false ? " [prefs soft-mismatch]" : ""}`
        );
        return { kind: "matched" as const, job, match, identityKey };
      } catch (e) {
        console.warn(
          `[Job discovery] [${platform}] Skipped listing ${listing.url}:`,
          e instanceof Error ? e.message : e
        );
        return { kind: "skipped" as const, identityKey };
      }
    });

    for (const outcome of outcomes) {
      evaluatedListingKeys.push(outcome.identityKey);
      if (outcome.kind === "matched") {
        if (knownKeys.has(outcome.identityKey)) continue;
        await saveJob(outcome.job);
        await saveJobMatch(outcome.match);
        knownKeys.add(outcome.identityKey);
        jobs.push(outcome.job);
        matches.push(outcome.match);
      } else if (outcome.kind === "rejected") {
        rejected++;
      }
    }
  } finally {
    await listingBrowser?.close().catch(() => undefined);
  }

  return {
    jobs,
    matches,
    evaluated: toScore.length,
    rejected,
    parseFailures,
    skippedKnown,
    evaluatedListingKeys,
    paused,
  };
}

export const jobDiscoveryAgent: Agent<JobDiscoveryInput, Job[]> = {
  name: "job-discovery-agent",
  async execute(
    input: JobDiscoveryInput,
    ctx: AgentContext
  ): Promise<AgentResult<Job[]>> {
    try {
      const settings = input.context.profile.settings;
      const fitScoreThreshold =
        input.minFitScore ?? settings.fitScoreThreshold ?? 85;
      const workflowId = input.workflowId;
      const round = input.round ?? 1;
      const skipIdentityKeys = new Set(input.skipIdentityKeys ?? []);
      const boards =
        settings.jobBoards?.length ? settings.jobBoards : DEFAULT_BOARDS;
      const playwrightUrls = settings.playwrightJobSearchUrls ?? [];
      const careerUrls = settings.careerPageUrls ?? [];
      const hasPrefs = Boolean(input.context.profile.jobPreferences?.trim());

      const apiBoards = boards.filter((b) =>
        (API_JOB_BOARDS as readonly string[]).includes(b)
      );
      let socialBoards = boards.filter((b) =>
        (PLAYWRIGHT_JOB_BOARDS as readonly string[]).includes(b)
      ) as ("linkedin" | "indeed")[];

      // Indeed SERP is often Cloudflare-walled and burns ~30s/query — LinkedIn guest is enough.
      if (socialBoards.includes("indeed")) {
        socialBoards = socialBoards.filter((b) => b !== "indeed");
        console.log(
          "[Job discovery] Skipping Indeed board search (unreliable locally; LinkedIn + APIs only)"
        );
      }

      const searchPlan = await generateTailoredSearchPlan(input.context);
      const searchTerms = searchPlan.queries;
      if (workflowId && (await isFindJobsStopped(workflowId))) {
        return { success: true, data: [], paused: await isWorkflowPaused(workflowId) };
      }

      console.log(
        `[Job discovery] Tailored search (${searchPlan.inferredLevel}): ${searchTerms.join(" | ")}`
      );
      if (searchPlan.rationale) {
        console.log(`[Job discovery] Search rationale: ${searchPlan.rationale}`);
      }

      const adzunaCountry = resolveAdzunaCountry(
        input.context.profile.preferredCountries
      );

      const apiListings =
        apiBoards.length > 0
          ? (
              await Promise.all(
                searchTerms.map((term) =>
                  searchJobBoards(term, apiBoards, adzunaCountry)
                )
              )
            ).flat()
          : [];

      const socialListings: DiscoveredJobListing[] = [];
      if (socialBoards.length > 0) {
        if (workflowId && (await isFindJobsStopped(workflowId))) {
          return { success: true, data: [], paused: await isWorkflowPaused(workflowId) };
        }
        // LinkedIn pages ~25 results; Indeed ~10. Advance both each round so we
        // don't re-score the same first page forever.
        const pageOffset = Math.max(0, (round - 1) * 25);
        console.log(
          `[Job discovery] Round ${round}: board pagination offset=${pageOffset}`
        );
        const remotePref = effectiveRemotePreference(
          input.context.profile.workPreference,
          input.context.profile.jobPreferences
        );
        if (remotePref === "remote" && input.context.profile.workPreference !== "remote") {
          console.log(
            "[Job discovery] Treating search as remote (from job preferences text)"
          );
        }
        const boardProfile = {
          preferredCountries: input.context.profile.preferredCountries,
          workPreference: remotePref,
          experienceLevel: searchPlan.inferredLevel,
          start: pageOffset,
        };

        if (supportsPlaywright()) {
          const { searchPlaywrightJobBoards } = await import(
            "@/agents/tools/job-discovery-social"
          );
          const batches = await Promise.all(
            searchTerms.map((query) =>
              searchPlaywrightJobBoards(query, socialBoards, ctx.userId, boardProfile)
            )
          );
          socialListings.push(...batches.flat());
        } else {
          console.log(
            "[Job discovery] Serverless mode: LinkedIn guest HTTP only (no Playwright)"
          );
          const batches = await Promise.all(
            searchTerms.map((query) =>
              searchJobBoardsHttp(query, socialBoards, ctx.userId, boardProfile)
            )
          );
          socialListings.push(...batches.flat());
        }
      }

      const playwrightListings: DiscoveredJobListing[] = [];
      if (playwrightUrls.length > 0 && supportsPlaywright()) {
        const { discoverJobsWithPlaywright } = await import(
          "@/agents/tools/job-discovery-browser"
        );
        for (const query of searchTerms) {
          if (workflowId && (await isFindJobsStopped(workflowId))) {
            return { success: true, data: [], paused: await isWorkflowPaused(workflowId) };
          }
          playwrightListings.push(
            ...(await discoverJobsWithPlaywright(
              playwrightUrls.map((url) => ({ url })),
              query,
              ctx.userId
            ))
          );
        }
      } else if (playwrightUrls.length > 0) {
        console.warn(
          "[Job discovery] Skipping custom Playwright search URLs on serverless"
        );
      }

      const careerListings =
        careerUrls.length > 0
          ? await discoverJobsFromCareerPages(careerUrls, ctx.userId)
          : [];

      const unique = interleaveListingsByPlatform(
        dedupeListings([
          ...apiListings,
          ...socialListings,
          ...playwrightListings,
          ...careerListings,
        ])
      );

      console.log(
        `[Job discovery] Round ${round} | ${seniorityLabel(searchPlan.inferredLevel)} search | Location: ${getPrimaryCountry(input.context.profile.preferredCountries) ?? "Worldwide"} | Queries: ${searchTerms.join(", ")} | Listings found: ${unique.length} (linkedin: ${unique.filter((l) => l.platform === "linkedin").length}, indeed: ${unique.filter((l) => l.platform === "indeed").length})`
      );

      // Prefer listings not yet evaluated in this continuous search.
      const fresh = unique.filter((l) => !skipIdentityKeys.has(listingIdentityKey(l)));
      const alreadySeen = unique.filter((l) => skipIdentityKeys.has(listingIdentityKey(l)));
      const prioritized = [...fresh, ...alreadySeen];

      let toEvaluate = prioritized;
      // Always preference-filter when prefs exist; otherwise only when over the eval cap.
      if (hasPrefs || prioritized.length > MAX_LISTINGS_TO_EVALUATE) {
        const candidatePool = fresh.length > 0 ? fresh : prioritized;
        console.log(
          `[Job discovery] Round ${round}: pre-filtering ${candidatePool.length} listings for ${searchPlan.inferredLevel}-level relevance${hasPrefs ? " + job preferences" : ""}…`
        );
        toEvaluate = await filterListingsForCandidate(
          candidatePool,
          input.context,
          55,
          searchPlan.inferredLevel
        );
        console.log(
          `[Job discovery] ${toEvaluate.length} listings passed seniority/relevance pre-filter`
        );
        if (toEvaluate.length === 0) {
          console.warn(
            `[Job discovery] Pre-filter removed all listings — using top ${MAX_LISTINGS_TO_EVALUATE} fresh results`
          );
          toEvaluate = candidatePool.slice(0, MAX_LISTINGS_TO_EVALUATE);
        } else if (toEvaluate.length > MAX_LISTINGS_TO_EVALUATE) {
          toEvaluate = toEvaluate.slice(0, MAX_LISTINGS_TO_EVALUATE);
        }
      }

      const {
        jobs,
        matches,
        evaluated,
        rejected,
        parseFailures,
        skippedKnown,
        evaluatedListingKeys,
        paused,
      } = await listingsToMatchedJobs(
          toEvaluate,
          ctx,
          input.context,
          searchTerms,
          fitScoreThreshold,
          workflowId,
          skipIdentityKeys
        );

      console.log(
        `[Job discovery] Round ${round}: AI evaluated ${evaluated} listings → ${jobs.length} new saved, ${skippedKnown} already known, ${rejected} rejected`
      );

      return {
        success: true,
        data: jobs,
        paused,
        metadata: {
          discovered: jobs.length,
          listingsFound: unique.length,
          evaluated,
          rejected,
          parseFailures,
          skippedKnown,
          matchesSaved: matches.length,
          evaluatedListingKeys,
          round,
          searchTerms,
          searchPlan: {
            inferredLevel: searchPlan.inferredLevel,
            queries: searchTerms,
            rationale: searchPlan.rationale,
          },
          boards,
        },
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Job discovery failed",
      };
    }
  },
};
