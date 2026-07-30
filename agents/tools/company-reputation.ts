import { supportsPlaywright } from "@/lib/runtime/capabilities";
import { nowIso } from "@/lib/utils/dates";
import {
  getCompanyReputationCache,
  saveCompanyReputationCache,
} from "@/services/firestore";
import type { CompanyReputation, CompanyReputationCache } from "@/lib/types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LEGAL_SUFFIXES =
  /\b(b\.?\s?v\.?|n\.?\s?v\.?|inc\.?|ltd\.?|llc\.?|corp\.?|co\.?|gmbh|ag|s\.?a\.?|plc|holding|groep|group)\b/gi;

export function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function tokenizeCompany(name: string): string[] {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Loose match so we don’t attach a wrong employer’s rating. */
export function companyNamesLikelyMatch(a: string, b: string): boolean {
  const keyA = normalizeCompanyKey(a);
  const keyB = normalizeCompanyKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (keyA.includes(keyB) || keyB.includes(keyA)) return true;

  // Indeed slugs like "Bol-7776a5c3" vs "Bol.com"
  const stem = (k: string) => k.split("-")[0] || k;
  if (stem(keyA).length >= 3 && stem(keyA) === stem(keyB)) return true;

  const tokA = new Set(tokenizeCompany(a));
  const tokB = new Set(tokenizeCompany(b));
  if (tokA.size === 0 || tokB.size === 0) return false;
  let overlap = 0;
  for (const t of tokA) if (tokB.has(t)) overlap++;
  const minSize = Math.min(tokA.size, tokB.size);
  return overlap >= Math.max(1, Math.ceil(minSize * 0.6));
}

function cacheToReputation(entry: CompanyReputationCache): CompanyReputation {
  return {
    rating: entry.rating,
    reviewCount: entry.reviewCount,
    source: "indeed",
    sourceUrl: entry.sourceUrl,
    summary: entry.summary,
    status: entry.status,
    checkedAt: entry.checkedAt,
  };
}

function isFresh(checkedAt: string): boolean {
  const age = Date.now() - new Date(checkedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

type ParsedIndeed = {
  displayName: string;
  rating: number;
  reviewCount?: number;
  sourceUrl: string;
};

type PageExtract = {
  noResults: boolean;
  blocked: boolean;
  candidates: {
    name: string;
    rating?: number;
    reviewCount?: number;
    cmpUrl: string;
  }[];
};

async function extractIndeedSearchCandidates(
  page: import("playwright").Page
): Promise<PageExtract> {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
    const blocked =
      /security check|captcha|unusual traffic|please verify/i.test(
        bodyText.slice(0, 900)
      );
    const noResults = /No result for/i.test(bodyText);

    const byCmp = new Map<
      string,
      { name: string; rating?: number; reviewCount?: number; cmpUrl: string }
    >();

    const anchors = Array.from(
      document.querySelectorAll('a[href*="/cmp/"]')
    ) as HTMLAnchorElement[];

    for (const a of anchors) {
      const href = a.href || "";
      const m = href.match(/\/cmp\/([^/?#]+)/i);
      if (!m?.[1]) continue;
      const slug = decodeURIComponent(m[1]);
      if (/^indeed$/i.test(slug)) continue;

      const cmpUrl = `https://www.indeed.com/cmp/${slug}`;
      const existing = byCmp.get(slug) || {
        name: "",
        cmpUrl,
      };

      const label = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (
        label &&
        !/^(reviews?|salaries|jobs|q&a|interviews|follow|write)/i.test(label) &&
        !/^\d/.test(label) &&
        label.length < 80
      ) {
        existing.name = existing.name || label;
      }

      // "3.6102 reviews" or "3.6 102 reviews" glued/spaced
      const ratingBlob = label.match(
        /^(\d(?:\.\d)?)\s*([\d,]*)\s*reviews?$/i
      );
      if (ratingBlob) {
        existing.rating = Number(ratingBlob[1]);
        if (ratingBlob[2]) {
          existing.reviewCount = Number(ratingBlob[2].replace(/,/g, ""));
        }
      }

      const parentText = (a.parentElement?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const parentRating = parentText.match(
        /(\d(?:\.\d)?)\s+([\d,]+)\s+reviews?/i
      );
      if (parentRating && existing.rating == null) {
        existing.rating = Number(parentRating[1]);
        existing.reviewCount = Number(parentRating[2].replace(/,/g, ""));
      }

      byCmp.set(slug, existing);
    }

    // Fallback: plain-text scan near "job openings"
    if (![...byCmp.values()].some((c) => c.rating != null)) {
      const re =
        /\b([A-Za-z0-9][A-Za-z0-9.&'’-]{0,40})\s+(\d(?:\.\d)?)\s+([\d,]+)\s+reviews?\b/gi;
      for (const m of bodyText.matchAll(re)) {
        const name = m[1].trim();
        if (
          /^(showing|search|company|find|results|rate|popular|based|openings|reviews|recent)$/i.test(
            name
          )
        ) {
          continue;
        }
        const slug = name.replace(/\s+/g, "-");
        byCmp.set(slug, {
          name,
          rating: Number(m[2]),
          reviewCount: Number(m[3].replace(/,/g, "")),
          cmpUrl: `https://www.indeed.com/cmp/${encodeURIComponent(slug)}`,
        });
      }
    }

    return {
      blocked,
      noResults,
      candidates: [...byCmp.values()].filter((c) => c.name || c.rating != null),
    };
  });
}

function pickCandidate(
  company: string,
  extracted: PageExtract
): ParsedIndeed | null {
  if (extracted.blocked || extracted.noResults) return null;

  const scored = extracted.candidates
    .map((c) => {
      const name = c.name || c.cmpUrl.split("/cmp/")[1] || "";
      const match = companyNamesLikelyMatch(company, name);
      const ratingOk =
        typeof c.rating === "number" && c.rating >= 1 && c.rating <= 5;
      return { c, name, match, ratingOk };
    })
    .filter((x) => x.match && x.ratingOk);

  // Prefer exact-ish short names
  scored.sort((a, b) => a.name.length - b.name.length);
  const best = scored[0];
  if (!best || best.c.rating == null) return null;

  return {
    displayName: best.name,
    rating: best.c.rating,
    reviewCount: best.c.reviewCount,
    sourceUrl: `${best.c.cmpUrl.replace(/\/$/, "")}/reviews`,
  };
}

function parseReviewsPageText(
  text: string,
  pageUrl: string,
  queryCompany: string
): ParsedIndeed | null {
  const overall =
    text.match(/Overall rating\s+(\d(?:\.\d)?)/i) ||
    text.match(/(\d(?:\.\d)?)\s+out of 5 stars/i);
  if (!overall?.[1]) return null;
  const rating = Number(overall[1]);
  if (!(rating >= 1 && rating <= 5)) return null;

  const countMatch =
    text.match(/Based on\s+([\d,]+)\s+reviews?/i) ||
    text.match(/\b([\d,]+)\s+Reviews?\b/);
  const reviewCount = countMatch
    ? Number(countMatch[1].replace(/,/g, ""))
    : undefined;

  const nameFromUrl = pageUrl.match(/\/cmp\/([^/?#]+)/i)?.[1];
  const displayName = nameFromUrl
    ? decodeURIComponent(nameFromUrl).replace(/-/g, " ")
    : queryCompany;

  return {
    displayName,
    rating,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : undefined,
    sourceUrl: pageUrl.split("?")[0],
  };
}

async function scrapeIndeedWithPlaywright(
  company: string
): Promise<ParsedIndeed | null> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: BROWSER_UA,
      locale: "en-US",
      viewport: { width: 1280, height: 900 },
    });

    const searchUrl = `https://www.indeed.com/companies/search?q=${encodeURIComponent(
      company
    )}`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2200);

    const extracted = await extractIndeedSearchCandidates(page);
    if (extracted.blocked) {
      console.warn(`[Company reputation] Indeed captcha on search for ${company}`);
      return null;
    }

    const fromSearch = pickCandidate(company, extracted);
    if (fromSearch) return fromSearch;

    // Fallback: guess slug and open reviews page
    const slug = company
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9._-]/g, "");
    if (!slug) return null;

    const reviewsUrl = `https://www.indeed.com/cmp/${encodeURIComponent(slug)}/reviews`;
    const revRes = await page.goto(reviewsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2200);
    if (revRes && revRes.status() >= 400) return null;

    const reviewsText = (await page.locator("body").innerText()).replace(
      /\s+/g,
      " "
    );
    if (
      /security check|captcha|page not found|doesn't exist/i.test(
        reviewsText.slice(0, 1200)
      )
    ) {
      return null;
    }

    return parseReviewsPageText(reviewsText, page.url(), company);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Live Indeed scrape (Playwright). Returns null when blocked / not found.
 * Does not write cache — use getOrFetchCompanyReputation for that.
 */
export async function fetchIndeedCompanyReputation(
  company: string
): Promise<CompanyReputation> {
  const checkedAt = nowIso();
  const trimmed = company.trim();
  if (!trimmed) {
    return {
      source: "indeed",
      status: "not_found",
      checkedAt,
      summary: "Empty company name",
    };
  }

  if (!supportsPlaywright()) {
    return {
      source: "indeed",
      status: "unavailable",
      checkedAt,
      summary: "Playwright unavailable in this runtime",
    };
  }

  try {
    const parsed = await scrapeIndeedWithPlaywright(trimmed);
    if (!parsed) {
      return {
        source: "indeed",
        status: "not_found",
        checkedAt,
        summary: "No Indeed company reviews found",
      };
    }
    return {
      rating: parsed.rating,
      reviewCount: parsed.reviewCount,
      source: "indeed",
      sourceUrl: parsed.sourceUrl,
      status: "ok",
      checkedAt,
      summary: `${parsed.displayName} · ${parsed.rating.toFixed(1)} / 5 on Indeed`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Company reputation] Scrape failed for ${trimmed}:`, msg);
    return {
      source: "indeed",
      status: "unavailable",
      checkedAt,
      summary: msg.slice(0, 160),
    };
  }
}

/**
 * Cache-first reputation lookup. Scrapes only when missing or older than 7 days.
 */
export async function getOrFetchCompanyReputation(
  company: string
): Promise<CompanyReputation> {
  const key = normalizeCompanyKey(company);
  if (!key) {
    return {
      source: "indeed",
      status: "not_found",
      checkedAt: nowIso(),
      summary: "Empty company name",
    };
  }

  const cached = await getCompanyReputationCache(key);
  if (cached && isFresh(cached.checkedAt)) {
    return cacheToReputation(cached);
  }

  const fresh = await fetchIndeedCompanyReputation(company);
  const entry: CompanyReputationCache = {
    id: key,
    companyName: company.trim(),
    rating: fresh.rating,
    reviewCount: fresh.reviewCount,
    source: "indeed",
    sourceUrl: fresh.sourceUrl,
    summary: fresh.summary,
    status: fresh.status,
    checkedAt: fresh.checkedAt,
    notes: fresh.summary,
  };
  try {
    await saveCompanyReputationCache(entry);
  } catch (e) {
    console.warn("[Company reputation] Cache write failed:", e);
  }
  return fresh;
}

export function reputationNeedsRefresh(
  rep: CompanyReputation | undefined
): boolean {
  if (!rep?.checkedAt) return true;
  if (!isFresh(rep.checkedAt)) return true;
  // Retry unavailable later; keep not_found / ok for TTL
  if (rep.status === "unavailable") return true;
  return false;
}
