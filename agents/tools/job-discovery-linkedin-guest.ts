import * as cheerio from "cheerio";
import { extractJobListingsWithAi } from "./job-discovery-ai";
import { logBoardError, logBoardInfo, logBoardWarn } from "./job-board-log";
import {
  linkedInExperienceFilter,
  linkedInRemoteFilter,
  resolveLinkedInLocation,
} from "@/lib/job-search/countries";
import type { ExperienceLevel } from "@/lib/types";
import type { DiscoveredJobListing } from "./job-discovery";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** LinkedIn guest API — HTTP only, no Playwright. Safe on Vercel. */
export async function searchLinkedInGuestApi(
  query: string,
  location: string,
  userId?: string,
  experienceLevel?: ExperienceLevel,
  start = 0,
  workPreference = "any",
  locale = "en-US"
): Promise<DiscoveredJobListing[]> {
  const expFilter = experienceLevel
    ? linkedInExperienceFilter(experienceLevel)
    : "";
  const remoteFilter = linkedInRemoteFilter(workPreference);
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=${Math.max(0, start)}${expFilter}${remoteFilter}&sortBy=DD`;
  try {
    logBoardInfo("linkedin", `Guest API request`, {
      url,
      query,
      location,
      start,
      workPreference,
    });
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": `${locale},en;q=0.8`,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logBoardWarn("linkedin", `Guest API HTTP ${res.status} for "${query}"`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 25000);
    const links: { url: string; text: string }[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const linkText = $(el).text().replace(/\s+/g, " ").trim();
      if (!href || !linkText) return;
      const absolute = href.startsWith("http")
        ? href
        : `https://www.linkedin.com${href}`;
      links.push({ url: absolute, text: linkText });
    });

    logBoardInfo("linkedin", `Guest API response`, {
      query,
      start,
      htmlChars: html.length,
      textChars: text.length,
      linkCount: links.length,
    });

    const listings = await extractJobListingsWithAi({
      pageUrl: url,
      pageText: text,
      links: links.slice(0, 150),
      searchQuery: query,
      platform: "linkedin",
      userId,
    });

    logBoardInfo("linkedin", `Guest API extracted listings`, {
      query,
      start,
      listings: listings.length,
    });
    return listings;
  } catch (e) {
    logBoardError("linkedin", `Guest API failed for "${query}"`, e);
    return [];
  }
}

/** HTTP-only board search for serverless (LinkedIn guest; Indeed requires Playwright). */
export async function searchJobBoardsHttp(
  query: string,
  boards: ("linkedin" | "indeed")[],
  userId: string,
  profile: {
    preferredCountries: string[];
    workPreference: string;
    experienceLevel?: ExperienceLevel;
    start?: number;
    locale?: string;
  }
): Promise<DiscoveredJobListing[]> {
  const location = resolveLinkedInLocation(
    profile.preferredCountries,
    profile.workPreference
  );
  const start = Math.max(0, profile.start ?? 0);
  const locale = profile.locale ?? "en-US";
  const results: DiscoveredJobListing[] = [];

  if (boards.includes("indeed")) {
    logBoardWarn(
      "indeed",
      "Skipping Indeed on serverless — Playwright is unavailable; use LinkedIn guest or API boards"
    );
  }

  if (boards.includes("linkedin")) {
    logBoardInfo("linkedin", `HTTP search start`, {
      query,
      location,
      start,
      workPreference: profile.workPreference,
      experienceLevel: profile.experienceLevel ?? "unspecified",
    });
    results.push(
      ...(await searchLinkedInGuestApi(
        query,
        location,
        userId,
        profile.experienceLevel,
        start,
        profile.workPreference,
        locale
      ))
    );
  }

  return results;
}
