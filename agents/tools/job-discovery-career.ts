import * as cheerio from "cheerio";
import { normalizeUrl } from "@/lib/utils/url";
import { htmlToText } from "./html";
import { extractJobListingsWithAi } from "./job-discovery-ai";
import type { DiscoveredJobListing } from "./job-discovery";

const MAX_CAREER_PAGES = 6;

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function fetchCareerPage(url: string): Promise<{
  text: string;
  links: { url: string; text: string }[];
}> {
  const res = await fetch(url, {
    headers: { "User-Agent": "CareerOS/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const links: { url: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    try {
      const href = $(el).attr("href");
      if (!href) return;
      const absolute = new URL(href, url).toString().replace(/\/$/, "");
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text && absolute.startsWith("http")) {
        links.push({ url: absolute, text });
      }
    } catch {
      // skip invalid links
    }
  });
  return { text: htmlToText(html), links };
}

/** Crawl company career pages + AI to find individual job postings. */
export async function discoverJobsFromCareerPages(
  careerUrls: string[],
  userId?: string
): Promise<DiscoveredJobListing[]> {
  const results: DiscoveredJobListing[] = [];
  const seenPages = new Set<string>();

  for (const rawUrl of careerUrls.slice(0, 5)) {
    const startUrl = normalizeUrl(rawUrl);
    const queue = [startUrl];

    while (queue.length > 0 && seenPages.size < MAX_CAREER_PAGES) {
      const pageUrl = queue.shift()!;
      if (seenPages.has(pageUrl)) continue;
      seenPages.add(pageUrl);

      try {
        const { text, links } = await fetchCareerPage(pageUrl);

        const extracted = await extractJobListingsWithAi({
          pageUrl,
          pageText: text,
          links,
          platform: "career_page",
          userId,
        });
        results.push(...extracted);

        if (seenPages.size < MAX_CAREER_PAGES) {
          for (const link of links) {
            if (
              sameOrigin(startUrl, link.url) &&
              !seenPages.has(link.url) &&
              /career|job|position|opening|role|hiring|vacancy/i.test(
                `${link.url} ${link.text}`
              )
            ) {
              queue.push(link.url);
            }
          }
        }
      } catch (e) {
        console.warn(
          `[Career page discovery] Failed for ${pageUrl}:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  return results;
}
