import * as cheerio from "cheerio";
import { chromium, type BrowserContext, type Page } from "playwright";
import { extractJobListingsWithAi } from "./job-discovery-ai";
import { searchLinkedInGuestApi } from "./job-discovery-linkedin-guest";
import {
  logBoardError,
  logBoardInfo,
  logBoardWarn,
} from "./job-board-log";
import {
  buildIndeedSearchUrl,
  linkedInExperienceFilter,
  linkedInRemoteFilter,
  resolveLinkedInLocation,
} from "@/lib/job-search/countries";
import type { ExperienceLevel } from "@/lib/types";
import type { DiscoveredJobListing } from "./job-discovery";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function getPageDiagnostics(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    textLength: document.body?.innerText?.length ?? 0,
    textPreview: (document.body?.innerText ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240),
    viewJobLinks: document.querySelectorAll('a[href*="viewjob"], a[href*="jk="]')
      .length,
    jobCards: document.querySelectorAll(
      "div.job_seen_beacon, div.cardOutline, .tapItem, .jobsearch-ResultsList > li"
    ).length,
    linkedInCards: document.querySelectorAll(
      ".base-search-card, .jobs-search-results-list__list-item, li"
    ).length,
  }));
}

async function createBrowserContext(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  locale = "en-US"
): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1366, height: 900 },
    locale,
    extraHTTPHeaders: {
      "Accept-Language": `${locale},en;q=0.9`,
    },
  });
}

async function scrapePageWithAi(
  page: Page,
  url: string,
  searchQuery: string,
  platform: "linkedin" | "indeed",
  userId?: string
): Promise<DiscoveredJobListing[]> {
  try {
    logBoardInfo(platform, `AI scrape starting`, { url, query: searchQuery });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    const diagnostics = await getPageDiagnostics(page);
    logBoardInfo(platform, `AI scrape page loaded`, diagnostics);

    const { text, links } = await page.evaluate(() => {
      const text = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
          url: (a as HTMLAnchorElement).href,
          text: (a as HTMLAnchorElement).innerText?.trim() ?? "",
        }))
        .filter((l) => l.url.startsWith("http") && l.text.length > 0);
      return { text: text.slice(0, 25000), links: links.slice(0, 150) };
    });

    logBoardInfo(platform, `AI scrape content`, {
      textChars: text.length,
      linkCount: links.length,
    });

    const listings = await extractJobListingsWithAi({
      pageUrl: url,
      pageText: text,
      links,
      searchQuery,
      platform,
      userId,
    });

    logBoardInfo(platform, `AI scrape finished`, {
      query: searchQuery,
      listings: listings.length,
    });
    return listings;
  } catch (e) {
    logBoardError(platform, `AI page scrape failed for "${searchQuery}"`, e);
    return [];
  }
}

async function dismissIndeedOverlays(page: Page): Promise<void> {
  const selectors = [
    "#onetrust-accept-btn-handler",
    'button:text("Accept")',
    'button:text("Alles accepteren")',
    'button:text("Tout accepter")',
    '[aria-label="Accept All"]',
    '[aria-label="Alle accepteren"]',
  ];

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 2000 });
        await page.waitForTimeout(800);
        logBoardInfo("indeed", `Dismissed overlay via ${selector}`);
        return;
      }
    } catch {
      // try next selector
    }
  }
}

function resolveIndeedJobUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString().replace(/\/$/, "");
  } catch {
    return href;
  }
}

async function extractIndeedListingsFromDom(
  page: Page,
  baseUrl: string
): Promise<DiscoveredJobListing[]> {
  try {
    const origin = new URL(baseUrl).origin;
    const raw = await page.evaluate((pageOrigin) => {
      const jobs: {
        title: string;
        company: string;
        url: string;
        location: string;
        snippet: string;
        jobKey: string;
      }[] = [];
      const seen = new Set<string>();

      const addJob = (job: {
        title: string;
        company: string;
        jobKey: string;
        location: string;
        snippet: string;
      }) => {
        const cleanTitle = job.title.replace(/\s+/g, " ").trim();
        const cleanKey = job.jobKey.trim();
        if (!cleanTitle || !cleanKey || seen.has(cleanKey)) return;
        seen.add(cleanKey);
        jobs.push({
          title: cleanTitle,
          company: job.company.replace(/\s+/g, " ").trim() || "Unknown",
          url: `${pageOrigin}/viewjob?jk=${cleanKey}`,
          location: job.location.replace(/\s+/g, " ").trim(),
          snippet: job.snippet.replace(/\s+/g, " ").trim(),
          jobKey: cleanKey,
        });
      };

      const cardRoots = new Set<Element>();
      document.querySelectorAll("[data-jk]").forEach((el) => cardRoots.add(el));
      document
        .querySelectorAll(
          "div.job_seen_beacon, div.cardOutline, .tapItem, .jobsearch-ResultsList > li"
        )
        .forEach((el) => cardRoots.add(el));

      cardRoots.forEach((card) => {
        const jobKey =
          card.getAttribute("data-jk") ??
          card.querySelector<HTMLElement>("[data-jk]")?.getAttribute("data-jk") ??
          "";
        if (!jobKey) return;

        const title =
          card.querySelector<HTMLElement>(
            'h2.jobTitle span, h2.jobTitle a, .jcs-JobTitle, [class*="jobTitle"]'
          )?.innerText?.trim() ??
          card.querySelector<HTMLAnchorElement>("a[href]")?.innerText?.trim() ??
          "";
        const company =
          card.querySelector<HTMLElement>(
            '[data-testid="company-name"], .companyName, .company'
          )?.innerText?.trim() ?? "Unknown";
        const location =
          card.querySelector<HTMLElement>(
            '[data-testid="text-location"], .companyLocation, .location'
          )?.innerText?.trim() ?? "";
        const snippet =
          card.querySelector<HTMLElement>(
            '.job-snippet, .metadata, [class*="snippet"], ul[style*="list-style"]'
          )?.innerText?.trim() ??
          card.querySelector<HTMLElement>(".jobCardShelf")?.innerText?.trim() ??
          "";

        addJob({ title, company, jobKey, location, snippet });
      });

      return jobs;
    }, origin);

    const listings = raw
      .map((job) => ({
        title: job.title,
        company: job.company,
        url: resolveIndeedJobUrl(job.url, baseUrl),
        location: job.location || undefined,
        snippet: job.snippet || undefined,
        jobKey: job.jobKey,
        platform: "indeed" as const,
      }))
      .filter((job) => job.title && job.url.includes("viewjob?jk="));

    logBoardInfo("indeed", `DOM parsed listings`, {
      total: listings.length,
      withSnippet: listings.filter((j) => (j.snippet?.length ?? 0) > 50).length,
      sampleUrl: listings[0]?.url,
    });

    return listings;
  } catch (e) {
    logBoardError("indeed", "DOM extraction failed", e);
    return [];
  }
}

async function isIndeedBlocked(page: Page): Promise<boolean> {
  const blocked = await page.evaluate(() => {
    const title = document.title.toLowerCase();
    const url = window.location.href.toLowerCase();
    const text = document.body?.innerText?.toLowerCase() ?? "";
    return (
      title.includes("security check") ||
      title.includes("blocked") ||
      title.includes("niet gevonden") ||
      title.includes("inloggen") ||
      title.includes("sign in") ||
      url.includes("secure.indeed.com/auth") ||
      url.includes("account/login") ||
      text.includes("verify you are human") ||
      text.includes("captcha") ||
      text.includes("unusual traffic") ||
      text.includes("extra verificatie vereist")
    );
  });
  return blocked;
}

/** LinkedIn — guest API first, Playwright + AI fallback. */
export async function searchLinkedInJobs(
  query: string,
  userId?: string,
  options?: {
    location?: string;
    workPreference?: string;
    experienceLevel?: ExperienceLevel;
    /** Pagination offset into LinkedIn results (0, 25, 50, …). */
    start?: number;
    locale?: string;
  }
): Promise<DiscoveredJobListing[]> {
  const location = options?.location ?? "Worldwide";
  const start = Math.max(0, options?.start ?? 0);
  const locale = options?.locale ?? "en-US";
  logBoardInfo("linkedin", `Search start`, {
    query,
    location,
    start,
    workPreference: options?.workPreference ?? "any",
    experienceLevel: options?.experienceLevel ?? "unspecified",
  });

  try {
    const guest = await searchLinkedInGuestApi(
      query,
      location,
      userId,
      options?.experienceLevel,
      start,
      options?.workPreference ?? "any",
      locale
    );
    if (guest.length >= 1) {
      logBoardInfo("linkedin", `Using guest API results`, {
        query,
        start,
        listings: guest.length,
      });
      return guest;
    }

    // Deep pagination with an empty guest page usually means end of results.
    // Playwright often reloads page 0 and re-returns duplicates — skip it.
    if (start > 0) {
      logBoardInfo("linkedin", `Guest API empty at offset ${start} — skipping Playwright fallback`, {
        query,
        start,
      });
      return [];
    }

    const remoteFilter = linkedInRemoteFilter(options?.workPreference ?? "any");
    const expFilter = options?.experienceLevel
      ? linkedInExperienceFilter(options.experienceLevel)
      : "";
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=${start}${remoteFilter}${expFilter}&sortBy=DD`;
    logBoardInfo("linkedin", `Guest API insufficient (${guest.length}), Playwright fallback`, {
      searchUrl,
      start,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await createBrowserContext(browser, locale);
      const page = await context.newPage();
      const scraped = await scrapePageWithAi(
        page,
        searchUrl,
        query,
        "linkedin",
        userId
      );
      const combined = dedupeByUrl([...guest, ...scraped]);
      logBoardInfo("linkedin", `Search complete`, {
        query,
        start,
        guest: guest.length,
        playwright: scraped.length,
        total: combined.length,
      });
      return combined;
    } catch (e) {
      logBoardError("linkedin", `Playwright search failed for "${query}"`, e);
      return guest;
    } finally {
      await browser.close();
    }
  } catch (e) {
    logBoardError("linkedin", `Search failed for "${query}"`, e);
    return [];
  }
}

/** Indeed — Playwright with DOM extraction + AI fallback. */
export async function searchIndeedJobs(
  query: string,
  userId?: string,
  preferredCountries: string[] = [],
  workPreference = "any",
  start = 0
): Promise<DiscoveredJobListing[]> {
  const searchUrl = buildIndeedSearchUrl(
    query,
    preferredCountries,
    workPreference,
    start
  );
  const locale = searchUrl.includes("nl.indeed") ? "nl-NL" : "en-US";

  logBoardInfo("indeed", `Search start`, {
    query,
    searchUrl,
    start,
    locale,
    countries: preferredCountries,
    workPreference,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await createBrowserContext(browser, locale);
    const page = await context.newPage();

    try {
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (e) {
      logBoardError("indeed", `page.goto failed for "${query}"`, e);
      throw e;
    }

    await dismissIndeedOverlays(page);

    if (await isIndeedBlocked(page)) {
      const diagnostics = await getPageDiagnostics(page);
      logBoardError(
        "indeed",
        `Blocked by login / security check for "${query}" — skipping`,
        diagnostics
      );
      return [];
    }

    let selectorFound = false;
    try {
      await page.waitForSelector(
        '#mosaic-provider-jobcards, .jobsearch-ResultsList, div.job_seen_beacon, a[href*="viewjob"]',
        { timeout: 12000 }
      );
      selectorFound = true;
    } catch (e) {
      logBoardWarn("indeed", `Job results selector not found for "${query}"`, e);
    }
    await page.waitForTimeout(2500);

    const diagnostics = await getPageDiagnostics(page);
    logBoardInfo("indeed", `Page diagnostics`, {
      query,
      start,
      selectorFound,
      ...diagnostics,
    });

    if (await isIndeedBlocked(page)) {
      logBoardError("indeed", `Blocked by security check / CAPTCHA for "${query}"`, diagnostics);
      return [];
    }

    const domListings = await extractIndeedListingsFromDom(page, searchUrl);
    if (domListings.length > 0) {
      logBoardInfo("indeed", `DOM extraction success`, {
        query,
        start,
        listings: domListings.length,
        sample: domListings.slice(0, 2).map((j) => j.title),
      });
      return dedupeByUrl(domListings);
    }

    logBoardWarn("indeed", `DOM found 0 listings for "${query}", trying AI fallback`);
    const aiListings = await scrapePageWithAi(
      page,
      searchUrl,
      query,
      "indeed",
      userId
    );
    logBoardInfo("indeed", `Search complete`, {
      query,
      start,
      dom: 0,
      ai: aiListings.length,
      total: aiListings.length,
    });
    return dedupeByUrl(aiListings);
  } catch (e) {
    logBoardError("indeed", `Search failed for "${query}"`, e);
    return [];
  } finally {
    await browser.close();
  }
}

async function runBoardSearch(
  board: "linkedin" | "indeed",
  search: () => Promise<DiscoveredJobListing[]>
): Promise<DiscoveredJobListing[]> {
  try {
    return await search();
  } catch (e) {
    logBoardError(board, "Unhandled search error", e);
    return [];
  }
}

export async function searchPlaywrightJobBoards(
  query: string,
  boards: ("linkedin" | "indeed")[],
  userId: string,
  profile: {
    preferredCountries: string[];
    workPreference: string;
    experienceLevel?: ExperienceLevel;
    /** Result offset for pagination across continuous-search rounds. */
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

  logBoardInfo("linkedin", `Batch start for "${query}"`, {
    boards,
    location,
    start,
    countries: profile.preferredCountries,
    experienceLevel: profile.experienceLevel ?? "unspecified",
  });

  const tasks: Promise<DiscoveredJobListing[]>[] = [];

  if (boards.includes("linkedin")) {
    tasks.push(
      runBoardSearch("linkedin", () =>
        searchLinkedInJobs(query, userId, {
          location,
          workPreference: profile.workPreference,
          experienceLevel: profile.experienceLevel,
          start,
          locale,
        })
      )
    );
  }

  if (boards.includes("indeed")) {
    tasks.push(
      runBoardSearch("indeed", () =>
        searchIndeedJobs(
          query,
          userId,
          profile.preferredCountries,
          profile.workPreference,
          start
        )
      )
    );
  }

  const batches = await Promise.all(tasks);
  const combined = batches.flat();
  const byPlatform = {
    linkedin: combined.filter((l) => l.platform === "linkedin").length,
    indeed: combined.filter((l) => l.platform === "indeed").length,
  };
  logBoardInfo("linkedin", `Batch complete for "${query}"`, { ...byPlatform, start });
  return combined;
}

function dedupeByUrl(listings: DiscoveredJobListing[]): DiscoveredJobListing[] {
  const seen = new Set<string>();
  return listings.filter((l) => {
    const key = l.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
