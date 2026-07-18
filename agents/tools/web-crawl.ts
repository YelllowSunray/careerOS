import { chromium, type Browser, type Page } from "playwright";

const MAX_PAGES = 30;
const MAX_DEPTH = 3;

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  links: string[];
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function extractPage(page: Page, url: string): Promise<CrawledPage> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const title = await page.title();
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean)
  );
  return { url, title, text: text.slice(0, 15000), links };
}

export async function crawlWebsite(startUrl: string): Promise<CrawledPage[]> {
  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) throw new Error("Invalid URL");

  let browser: Browser | null = null;
  const visited = new Set<string>();
  const results: CrawledPage[] = [];
  const queue: { url: string; depth: number }[] = [{ url: normalizedStart, depth: 0 }];

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    while (queue.length > 0 && results.length < MAX_PAGES) {
      const item = queue.shift()!;
      if (visited.has(item.url)) continue;
      visited.add(item.url);

      try {
        const crawled = await extractPage(page, item.url);
        results.push(crawled);

        if (item.depth < MAX_DEPTH) {
          for (const link of crawled.links) {
            const normalized = normalizeUrl(item.url, link);
            if (
              normalized &&
              sameOrigin(normalizedStart, normalized) &&
              !visited.has(normalized)
            ) {
              queue.push({ url: normalized, depth: item.depth + 1 });
            }
          }
        }
      } catch {
        // skip failed pages
      }
    }
  } finally {
    await browser?.close();
  }

  return results;
}
