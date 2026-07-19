import { extractLinkedInJobId } from "@/lib/job-search/identity";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export { BROWSER_UA };

/** Canonical guest job view — same page "View posting" opens in your browser. */
export function toGuestLinkedInJobUrl(url: string): string {
  const id = extractLinkedInJobId(url);
  if (!id) return url;
  // Always www — nl./de. hosts often 404 on guest job views.
  return `https://www.linkedin.com/jobs/view/${id}`;
}

export function isLinkedInAuthWall(url: string): boolean {
  return /linkedin\.com\/(authwall|checkpoint|login)/i.test(url);
}

export function isLinkedInHostname(url: string): boolean {
  try {
    return new URL(url).hostname.includes("linkedin.com");
  } catch {
    return /linkedin\.com/i.test(url);
  }
}

/** True when URL is a third-party ATS / company site (safe to open without LinkedIn login). */
export function isOffsiteApplicationUrl(url: string): boolean {
  if (!url || url === "about:blank") return false;
  return !isLinkedInHostname(url);
}

/**
 * LinkedIn external-apply links are often redirect wrappers.
 * Unwrap to the real company application URL so we skip authwall.
 */
export function unwrapLinkedInApplyUrl(url: string): string {
  let current = url;

  for (let depth = 0; depth < 6; depth++) {
    try {
      const parsed = new URL(current);
      if (!parsed.hostname.includes("linkedin.com")) return current;

      if (
        parsed.pathname.includes("/redir/redirect") ||
        parsed.pathname.includes("/redirect")
      ) {
        const target = parsed.searchParams.get("url");
        if (target) {
          current = decodeURIComponent(target);
          continue;
        }
      }

      break;
    } catch {
      break;
    }
  }

  return current;
}

export function resolveApplicationDestination(url: string): string {
  return unwrapLinkedInApplyUrl(url);
}
