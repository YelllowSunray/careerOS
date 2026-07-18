import { chromium } from "playwright";
import { extractJobListingsWithAi } from "./job-discovery-ai";
import type { DiscoveredJobListing } from "./job-discovery";

export interface PlaywrightSearchTarget {
  url: string;
  label?: string;
}

function buildSearchUrl(template: string, query: string): string {
  return template.replace(/\{query\}/gi, encodeURIComponent(query));
}

/** Playwright + AI: browse a job search page and extract listings. */
export async function discoverJobsWithPlaywright(
  targets: PlaywrightSearchTarget[],
  searchQuery: string,
  userId?: string
): Promise<DiscoveredJobListing[]> {
  if (targets.length === 0) return [];

  const browser = await chromium.launch({ headless: true });
  const results: DiscoveredJobListing[] = [];

  try {
    const page = await browser.newPage();

    for (const target of targets.slice(0, 5)) {
      const url = buildSearchUrl(target.url, searchQuery);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2000);

        const { text, links } = await page.evaluate(() => {
          const text = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
          const links = Array.from(document.querySelectorAll("a[href]"))
            .map((a) => ({
              url: (a as HTMLAnchorElement).href,
              text: (a as HTMLAnchorElement).innerText?.trim() ?? "",
            }))
            .filter((l) => l.url.startsWith("http") && l.text.length > 0);
          return { text: text.slice(0, 20000), links: links.slice(0, 120) };
        });

        const extracted = await extractJobListingsWithAi({
          pageUrl: url,
          pageText: text,
          links,
          searchQuery,
          platform: "playwright",
          userId,
        });

        results.push(...extracted);
      } catch (e) {
        console.warn(
          `[Playwright discovery] Failed for ${url}:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
