import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import {
  generateTailoredSearchPlan,
  parseJobPosting,
  searchJobBoards,
  listingToJobFallback,
  dedupeListings,
  interleaveListingsByPlatform,
  resolveAdzunaCountry,
} from "@/agents/tools/job-discovery";
import { filterListingsForCandidate } from "@/agents/tools/job-discovery-ai";
import { seniorityLabel } from "@/lib/job-search/tailored-queries";
import { discoverJobsWithPlaywright } from "@/agents/tools/job-discovery-browser";
import { discoverJobsFromCareerPages } from "@/agents/tools/job-discovery-career";
import { validateListingIsJobPosting } from "@/agents/tools/job-discovery-ai";
import { matchListingToCandidate } from "@/agents/tools/job-match";
import {
  createIndeedBrowser,
  fetchListingContent,
} from "@/agents/tools/listing-fetch";
import type { Browser } from "playwright";
import { saveJob, saveJobMatch, getKnownJobIdentityKeys } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import { listingIdentityKey, stableJobId } from "@/lib/job-search/identity";
import { toGuestLinkedInJobUrl, isLinkedInHostname } from "@/lib/job-search/linkedin-urls";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { DiscoveredJobListing } from "@/agents/tools/job-discovery";
import { searchPlaywrightJobBoards } from "@/agents/tools/job-discovery-social";
import { isWorkflowPaused } from "@/lib/workflows/pause";
import { getPrimaryCountry } from "@/lib/job-search/countries";
import { API_JOB_BOARDS, PLAYWRIGHT_JOB_BOARDS, type Job, type JobBoard, type JobMatch } from "@/lib/types";

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
const MAX_LISTINGS_TO_EVALUATE = 35;
const MIN_FIT_TO_SAVE = 50;

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

  const candidates = listings.filter((listing) => {
    const key = listingIdentityKey(listing);
    if (knownKeys.has(key) || skipIdentityKeys.has(key)) {
      skippedKnown++;
      return false;
    }
    return true;
  });

  if (skippedKnown > 0) {
    console.log(
      `[Job discovery] Skipping ${skippedKnown} already-evaluated listings; ${candidates.length} left to score`
    );
  }

  const hasIndeed = candidates.some((l) => l.platform === "indeed");
  let indeedBrowser: Browser | null = null;
  if (hasIndeed) {
    try {
      indeedBrowser = await createIndeedBrowser();
    } catch (e) {
      console.warn("[Job discovery] Failed to launch Indeed browser:", e);
    }
  }

  try {
    for (const listing of candidates.slice(0, MAX_LISTINGS_TO_EVALUATE)) {
      if (workflowId && (await isWorkflowPaused(workflowId))) {
        return {
          jobs,
          matches,
          evaluated: jobs.length + rejected + parseFailures + skippedKnown,
          rejected,
          parseFailures,
          skippedKnown,
          evaluatedListingKeys,
          paused: true,
        };
      }

      const platform = listing.platform ?? "unknown";
      const identityKey = listingIdentityKey(listing);

      try {
        const text = await fetchListingContent(listing, indeedBrowser);

        const validation = await validateListingIsJobPosting(
          listing,
          text,
          ctx.userId
        );
        if (!validation.isJobPosting) {
          console.log(
            `[Job discovery] [${platform}] Not a job posting: ${listing.title} — ${validation.reason}`
          );
          rejected++;
          evaluatedListingKeys.push(identityKey);
          continue;
        }

        let matchResult;
        try {
          matchResult = await matchListingToCandidate(context, listing, text);
        } catch (e) {
          console.warn(
            `[Job discovery] [${platform}] AI match failed for ${listing.url}:`,
            e instanceof Error ? e.message : e
          );
          rejected++;
          evaluatedListingKeys.push(identityKey);
          continue;
        }

        if (matchResult.fitScore < MIN_FIT_TO_SAVE) {
          console.log(
            `[Job discovery] [${platform}] Rejected (${matchResult.fitScore}): ${listing.title} @ ${listing.company}`
          );
          rejected++;
          evaluatedListingKeys.push(identityKey);
          continue;
        }

        let parsed: Awaited<ReturnType<typeof parseJobPosting>> | null = null;
        try {
          parsed = await parseJobPosting(text, listing.url, ctx.userId);
        } catch {
          parseFailures++;
        }

        const fallback = listingToJobFallback(listing, text, ctx.userId, searchTerms);
        const jobId = stableJobId(ctx.userId, identityKey);
        const rawApplicationUrl =
          parsed?.applicationUrl || fallback.applicationUrl || listing.url;
        const applicationUrl = isLinkedInHostname(rawApplicationUrl)
          ? toGuestLinkedInJobUrl(rawApplicationUrl)
          : rawApplicationUrl;

        const job: Job = {
          id: jobId,
          userId: ctx.userId,
          title: parsed?.title || fallback.title,
          company: parsed?.company || fallback.company,
          applicationUrl,
          source: listing.platform === "career_page" ? "career_page" : "job_board",
          sourcePlatform: listing.platform,
          location: parsed?.location || fallback.location,
          remoteType: parsed?.remoteType,
          description: parsed?.description || fallback.description,
          requirements: parsed?.requirements ?? fallback.requirements,
          extractedSkills: parsed?.extractedSkills?.length
            ? parsed.extractedSkills
            : fallback.extractedSkills,
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
          matchedAt: nowIso(),
        };

        await saveJob(job);
        await saveJobMatch(match);
        knownKeys.add(identityKey);
        evaluatedListingKeys.push(identityKey);
        jobs.push(job);
        matches.push(match);

        console.log(
          `[Job discovery] [${platform}] Matched (${matchResult.fitScore}): ${job.title} @ ${job.company}`
        );
      } catch (e) {
        console.warn(
          `[Job discovery] [${platform}] Skipped listing ${listing.url}:`,
          e instanceof Error ? e.message : e
        );
        evaluatedListingKeys.push(identityKey);
      }
    }
  } finally {
    await indeedBrowser?.close();
  }

  return {
    jobs,
    matches,
    evaluated: Math.min(candidates.length, MAX_LISTINGS_TO_EVALUATE),
    rejected,
    parseFailures,
    skippedKnown,
    evaluatedListingKeys,
    paused: false,
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

      const apiBoards = boards.filter((b) =>
        (API_JOB_BOARDS as readonly string[]).includes(b)
      );
      const socialBoards = boards.filter((b) =>
        (PLAYWRIGHT_JOB_BOARDS as readonly string[]).includes(b)
      ) as ("linkedin" | "indeed")[];

      const searchPlan = await generateTailoredSearchPlan(input.context);
      const searchTerms = searchPlan.queries;
      if (workflowId && (await isWorkflowPaused(workflowId))) {
        return { success: true, data: [], paused: true };
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
        if (workflowId && (await isWorkflowPaused(workflowId))) {
          return { success: true, data: [], paused: true };
        }
        // LinkedIn pages ~25 results; Indeed ~10. Advance both each round so we
        // don't re-score the same first page forever.
        const pageOffset = Math.max(0, (round - 1) * 25);
        console.log(
          `[Job discovery] Round ${round}: board pagination offset=${pageOffset}`
        );
        const batches = await Promise.all(
          searchTerms.map((query) =>
            searchPlaywrightJobBoards(
              query,
              socialBoards,
              ctx.userId,
              {
                preferredCountries: input.context.profile.preferredCountries,
                workPreference: input.context.profile.workPreference,
                experienceLevel: searchPlan.inferredLevel,
                start: pageOffset,
              }
            )
          )
        );
        socialListings.push(...batches.flat());
      }

      const playwrightListings: DiscoveredJobListing[] = [];
      if (playwrightUrls.length > 0) {
        for (const query of searchTerms) {
          if (workflowId && (await isWorkflowPaused(workflowId))) {
            return { success: true, data: [], paused: true };
          }
          playwrightListings.push(
            ...(await discoverJobsWithPlaywright(
              playwrightUrls.map((url) => ({ url })),
              query,
              ctx.userId
            ))
          );
        }
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
      if (prioritized.length > MAX_LISTINGS_TO_EVALUATE) {
        const candidatePool = fresh.length > 0 ? fresh : prioritized;
        console.log(
          `[Job discovery] Round ${round}: pre-filtering ${candidatePool.length} listings for ${searchPlan.inferredLevel}-level relevance…`
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
