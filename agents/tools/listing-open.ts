import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { logBoardWarn } from "@/agents/tools/job-board-log";
import type { DiscoveredJobListing } from "@/agents/tools/job-discovery";

export type ListingOpenStatus = "open" | "closed" | "dead" | "unknown";

export interface ListingAvailability {
  status: ListingOpenStatus;
  /** True when we should score/show the job as an active opportunity */
  acceptingApplications: boolean;
  reason: string;
  httpStatus?: number;
}

const openSchema = z.object({
  acceptingApplications: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Probe whether the listing URL still resolves (dead link detection). */
export async function probeListingUrl(url: string): Promise<{
  status: ListingOpenStatus;
  httpStatus?: number;
  notes: string;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const httpStatus = res.status;
    if (httpStatus === 404 || httpStatus === 410 || httpStatus === 451) {
      return {
        status: "dead",
        httpStatus,
        notes: `Listing URL returned HTTP ${httpStatus}`,
      };
    }
    if (httpStatus >= 500) {
      return {
        status: "unknown",
        httpStatus,
        notes: `Listing URL temporary error HTTP ${httpStatus}`,
      };
    }
    // 401/403 common for LinkedIn auth walls — not proof the job is dead.
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        status: "unknown",
        httpStatus,
        notes: `Listing URL auth-walled (HTTP ${httpStatus}) — not treated as dead`,
      };
    }
    if (!res.ok) {
      return {
        status: "unknown",
        httpStatus,
        notes: `Listing URL HTTP ${httpStatus}`,
      };
    }
    return {
      status: "open",
      httpStatus,
      notes: `Listing URL reachable (HTTP ${httpStatus})`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/aborted|timeout/i.test(msg)) {
      return { status: "unknown", notes: "Listing URL probe timed out" };
    }
    return {
      status: "dead",
      notes: `Listing URL unreachable: ${msg.slice(0, 160)}`,
    };
  }
}

/**
 * AI judges whether the posting is still accepting applications.
 * Uses full posting text when available — no keyword blacklists.
 */
export async function assessListingAcceptingApplications(input: {
  listing: Pick<
    DiscoveredJobListing,
    "title" | "company" | "location" | "platform" | "url"
  >;
  postingText: string;
  userId?: string;
}): Promise<{
  acceptingApplications: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}> {
  const text = input.postingText.trim();
  if (text.length < 40) {
    return {
      acceptingApplications: true,
      confidence: "low",
      reason: "Too little posting text to judge openness — keeping for match.",
    };
  }

  try {
    return await generateStructured(
      `Decide if this job listing is STILL ACCEPTING APPLICATIONS (an open role a candidate can apply to now).

Return acceptingApplications=false when the page/content clearly indicates:
- the job is closed, filled, expired, or no longer accepting applicants
- "this job is no longer available" / similar board messages
- the page is only an error or removed listing (not a real open role)

Return acceptingApplications=true when:
- it reads like an active open role, OR
- you are unsure (prefer keeping uncertain listings)

Use judgment on the full content — do not rely on a fixed keyword list.
confidence: high when the page is explicit; medium when likely; low when guessing.

LISTING:
Title: ${input.listing.title}
Company: ${input.listing.company}
Location: ${input.listing.location ?? "unknown"}
Platform: ${input.listing.platform}
URL: ${input.listing.url}

CONTENT:
${text.slice(0, 10000)}

Return JSON: { "acceptingApplications": true/false, "confidence": "high"|"medium"|"low", "reason": "1 sentence" }`,
      openSchema,
      {
        userId: input.userId,
        operation: "listing_open_check",
      }
    );
  } catch (e) {
    const platform =
      input.listing.platform === "linkedin" || input.listing.platform === "indeed"
        ? input.listing.platform
        : null;
    if (platform) {
      logBoardWarn(platform, `Open-status AI check failed — keeping listing`, e);
    }
    return {
      acceptingApplications: true,
      confidence: "low",
      reason: "Open-status check failed — keeping listing",
    };
  }
}

/**
 * Combined dead-link + closed-job gate for discovery / revalidation.
 * Rejects only on clear dead URLs or high/medium-confidence closed AI judgment.
 */
export async function checkListingAvailability(input: {
  listing: DiscoveredJobListing;
  postingText: string;
  userId?: string;
  /** Skip URL probe when fetch already proved the page loads */
  skipUrlProbe?: boolean;
  fetchFailed?: boolean;
  fetchError?: string;
}): Promise<ListingAvailability> {
  if (input.fetchFailed) {
    const probe = await probeListingUrl(input.listing.url);
    if (probe.status === "dead") {
      return {
        status: "dead",
        acceptingApplications: false,
        reason: probe.notes,
        httpStatus: probe.httpStatus,
      };
    }
    // Fetch failed but URL might still be auth-walled — try AI on whatever text we have
  } else if (!input.skipUrlProbe) {
    const probe = await probeListingUrl(input.listing.url);
    if (probe.status === "dead") {
      return {
        status: "dead",
        acceptingApplications: false,
        reason: probe.notes,
        httpStatus: probe.httpStatus,
      };
    }
  }

  const ai = await assessListingAcceptingApplications({
    listing: input.listing,
    postingText: input.postingText,
    userId: input.userId,
  });

  if (
    !ai.acceptingApplications &&
    (ai.confidence === "high" || ai.confidence === "medium")
  ) {
    return {
      status: "closed",
      acceptingApplications: false,
      reason: ai.reason,
    };
  }

  return {
    status: "open",
    acceptingApplications: true,
    reason: ai.reason || "Listing appears open",
  };
}
