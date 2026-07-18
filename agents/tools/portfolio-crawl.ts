import * as cheerio from "cheerio";
import { normalizeUrl } from "@/lib/utils/url";

const MAX_PAGES = 8;
const MAX_DEPTH = 2;

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function fetchPage(url: string): Promise<CrawledPage | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CareerOS/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer").remove();
    const title = $("title").text().trim();
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000);
    return { url, title, text };
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    try {
      const href = $(el).attr("href");
      if (!href) return;
      const absolute = new URL(href, baseUrl).toString().replace(/\/$/, "");
      if (sameOrigin(baseUrl, absolute)) links.push(absolute);
    } catch {
      // skip invalid links
    }
  });
  return links;
}

/** Fast HTTP-only crawl — no Playwright, no Gemini. */
export async function crawlPortfolioSite(startUrl: string): Promise<CrawledPage[]> {
  const normalized = normalizeUrl(startUrl);
  const visited = new Set<string>();
  const results: CrawledPage[] = [];
  const queue: { url: string; depth: number }[] = [{ url: normalized, depth: 0 }];

  while (queue.length > 0 && results.length < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "CareerOS/1.0" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const page = await fetchPage(url);
      if (page?.text) results.push(page);

      if (depth < MAX_DEPTH) {
        for (const link of extractLinks(html, url)) {
          if (!visited.has(link)) queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch {
      // skip failed pages
    }
  }

  return results;
}
