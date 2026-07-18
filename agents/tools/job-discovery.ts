import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeJobPosting } from "@/lib/gemini/coerce";
import { generateTailoredSearchPlan, type TailoredSearchPlan } from "@/lib/job-search/tailored-queries";
import { resolveAdzunaCountryCode } from "@/lib/job-search/countries";
import { listingIdentityKey } from "@/lib/job-search/identity";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { JobBoard } from "@/lib/types";
import { API_JOB_BOARDS } from "@/lib/types";

const JOB_JSON_SHAPE = `{
  "title": "string",
  "company": "string",
  "location": "string",
  "remoteType": "remote" | "hybrid" | "onsite" | "any" (optional),
  "description": "string",
  "requirements": {
    "required": [{ "skill": "string", "description": "string (optional)" }],
    "preferred": [{ "skill": "string", "description": "string (optional)" }]
  },
  "extractedSkills": ["string"],
  "applicationUrl": "string"
}`;

const jobParseSchema = z.preprocess(
  (raw) => normalizeJobPosting(raw),
  z.object({
    title: z.string(),
    company: z.string(),
    location: z.string(),
    remoteType: z.enum(["remote", "hybrid", "onsite", "any"]).optional(),
    description: z.string(),
    requirements: z.object({
      required: z.array(z.object({ skill: z.string(), description: z.string().optional() })),
      preferred: z.array(z.object({ skill: z.string(), description: z.string().optional() })),
    }),
    extractedSkills: z.array(z.string()),
    applicationUrl: z.string(),
  })
);

export async function parseJobPosting(
  text: string,
  url: string,
  userId?: string,
  operation = "job_parse"
) {
  return generateStructured(
    `Parse this job posting into structured JSON for a job matching system.
Distinguish hard requirements from nice-to-have preferred skills.
Use these exact field names: title, company, location, description, requirements, extractedSkills, applicationUrl.

Return JSON matching this shape:
${JOB_JSON_SHAPE}

Source URL (use for applicationUrl if not found in text): ${url}

JOB POSTING:
${text.slice(0, 15000)}`,
    jobParseSchema,
    { userId, operation }
  );
}

export type { TailoredSearchPlan };
export { generateTailoredSearchPlan, inferExperienceLevelFromContext } from "@/lib/job-search/tailored-queries";

/** Job board search — AI-tailored queries with seniority-aware role titles. */
export async function generateJobSearchQueries(
  context: CandidateContext
): Promise<string[]> {
  const plan = await generateTailoredSearchPlan(context);
  return plan.queries;
}

export interface DiscoveredJobListing {
  title: string;
  company: string;
  url: string;
  location?: string;
  tags?: string[];
  /** SERP snippet / summary when full posting fetch is unavailable */
  snippet?: string;
  /** Indeed job key for canonical viewjob URLs */
  jobKey?: string;
  platform: JobBoard | "playwright" | "career_page";
}

export async function searchRemotiveJobs(query: string): Promise<DiscoveredJobListing[]> {
  try {
    const res = await fetch(
      `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs ?? []).map(
      (j: {
        title: string;
        company_name: string;
        url: string;
        candidate_required_location: string;
        tags: string[];
      }) => ({
        title: j.title,
        company: j.company_name,
        url: j.url,
        location: j.candidate_required_location,
        tags: j.tags,
        platform: "remotive" as const,
      })
    );
  } catch {
    return [];
  }
}

export async function searchArbeitnowJobs(query: string): Promise<DiscoveredJobListing[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];

  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const queryWords = q.split(/\s+/).filter((w) => w.length >= 2);

    return (data.data ?? [])
      .filter((j: { title: string; tags: string[] }) => {
        const title = j.title.toLowerCase();
        const tags = (j.tags ?? []).map((t: string) => t.toLowerCase());
        return queryWords.every(
          (word) =>
            title.includes(word) ||
            tags.some((tag: string) => tag.includes(word))
        );
      })
      .slice(0, 10)
      .map(
        (j: {
          title: string;
          company: string;
          url: string;
          location: string;
          tags: string[];
        }) => ({
          title: j.title,
          company: j.company,
          url: j.url,
          location: j.location,
          tags: j.tags,
          platform: "arbeitnow" as const,
        })
      );
  } catch {
    return [];
  }
}

export async function searchRemoteOkJobs(query: string): Promise<DiscoveredJobListing[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];

  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "CareerOS/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const queryWords = q.split(/\s+/).filter((w) => w.length >= 2);
    return data
      .filter((j) => j.id && j.position)
      .filter((j) => {
        const title = String(j.position ?? "").toLowerCase();
        const tags = Array.isArray(j.tags) ? j.tags.map(String) : [];
        return queryWords.every(
          (word) =>
            title.includes(word) ||
            tags.some((t) => t.toLowerCase().includes(word))
        );
      })
      .slice(0, 10)
      .map((j) => ({
        title: String(j.position ?? ""),
        company: String(j.company ?? "Unknown"),
        url: String(j.url ?? `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`),
        location: j.location ? String(j.location) : "Remote",
        tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
        platform: "remoteok" as const,
      }));
  } catch {
    return [];
  }
}

export function resolveAdzunaCountry(profileCountries: string[]): string {
  return resolveAdzunaCountryCode(profileCountries);
}

export async function searchAdzunaJobs(
  query: string,
  country = "us"
): Promise<DiscoveredJobListing[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.warn("[Adzuna] ADZUNA_APP_ID / ADZUNA_APP_KEY not set — skipping");
    return [];
  }

  try {
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("what", query);
    url.searchParams.set("results_per_page", "10");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map(
      (j: {
        title: string;
        company: { display_name: string };
        redirect_url: string;
        location: { display_name: string };
        description: string;
      }) => ({
        title: j.title,
        company: j.company?.display_name ?? "Unknown",
        url: j.redirect_url,
        location: j.location?.display_name ?? "",
        tags: [],
        platform: "adzuna" as const,
      })
    );
  } catch {
    return [];
  }
}

export async function searchJobBoards(
  query: string,
  boards: JobBoard[],
  country = "us"
): Promise<DiscoveredJobListing[]> {
  const apiBoards = boards.filter((b) =>
    (API_JOB_BOARDS as readonly string[]).includes(b)
  );
  const results: DiscoveredJobListing[] = [];
  if (apiBoards.includes("remotive")) {
    results.push(...(await searchRemotiveJobs(query)));
  }
  if (apiBoards.includes("arbeitnow")) {
    results.push(...(await searchArbeitnowJobs(query)));
  }
  if (apiBoards.includes("remoteok")) {
    results.push(...(await searchRemoteOkJobs(query)));
  }
  if (apiBoards.includes("adzuna")) {
    results.push(...(await searchAdzunaJobs(query, country)));
  }
  return results;
}

export function dedupeListings(listings: DiscoveredJobListing[]): DiscoveredJobListing[] {
  const seen = new Set<string>();
  return listings.filter((l) => {
    const key = listingIdentityKey(l);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Round-robin by platform so one board doesn't consume all evaluation slots. */
export function interleaveListingsByPlatform(
  listings: DiscoveredJobListing[]
): DiscoveredJobListing[] {
  const buckets = new Map<string, DiscoveredJobListing[]>();
  for (const listing of listings) {
    const key = listing.platform ?? "other";
    const bucket = buckets.get(key) ?? [];
    bucket.push(listing);
    buckets.set(key, bucket);
  }

  const result: DiscoveredJobListing[] = [];
  let index = 0;
  while (result.length < listings.length) {
    let added = false;
    for (const bucket of buckets.values()) {
      if (index < bucket.length) {
        result.push(bucket[index]);
        added = true;
      }
    }
    if (!added) break;
    index++;
  }
  return result;
}

export function listingToJobFallback(
  listing: DiscoveredJobListing,
  pageText: string,
  userId: string,
  searchTerms: string[]
) {
  return {
    title: listing.title,
    company: listing.company,
    applicationUrl: listing.url,
    location: listing.location || "Remote",
    description: listing.snippet
      ? `${listing.snippet}\n\n${pageText.slice(0, 5000)}`.trim()
      : pageText.slice(0, 5000) || listing.title,
    requirements: { required: [], preferred: [] },
    extractedSkills: listing.tags ?? [],
    sourcePlatform: listing.platform,
    discoveredVia: searchTerms.filter(
      (t) =>
        listing.title.toLowerCase().includes(t.toLowerCase()) ||
        (listing.tags ?? []).some((tag) => tag.toLowerCase().includes(t.toLowerCase()))
    ),
    userId,
  };
}
