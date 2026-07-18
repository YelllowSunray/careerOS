import * as cheerio from "cheerio";

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
}

const BLOCKED_PAGE_PATTERNS = [
  /security check/i,
  /verify you are human/i,
  /captcha/i,
  /unusual traffic/i,
  /we gebruiken cookies/i,
  /enable cookies/i,
];

export function isBlockedPageText(text: string): boolean {
  const sample = text.slice(0, 1500);
  if (sample.length < 80) return true;
  return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(sample));
}

export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
  const text = htmlToText(html);
  if (isBlockedPageText(text)) {
    throw new Error(`Blocked or invalid page content for ${url}`);
  }
  return text;
}
