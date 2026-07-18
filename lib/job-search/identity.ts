import { createHash } from "crypto";
import type { DiscoveredJobListing } from "@/agents/tools/job-discovery";
import type { Job } from "@/lib/types";

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fromage",
  "vjk",
  "sid",
  "trk",
  "refId",
  "trackingId",
];

export function extractIndeedJobKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const jk = parsed.searchParams.get("jk");
    if (jk) return jk;
  } catch {
    // fall through
  }
  const match = url.match(/[?&]jk=([a-z0-9]+)/i);
  return match?.[1] ?? null;
}

export function extractLinkedInJobId(url: string): string | null {
  const viewMatch = url.match(/\/jobs\/view\/(\d+)/i);
  if (viewMatch?.[1]) return viewMatch[1];
  const paramMatch = url.match(/[?&]currentJobId=(\d+)/i);
  return paramMatch?.[1] ?? null;
}

export function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const param of TRACKING_PARAMS) {
      parsed.searchParams.delete(param);
    }
    const path = parsed.pathname.replace(/\/$/, "");
    const search = parsed.searchParams.toString();
    return `${parsed.origin}${path}${search ? `?${search}` : ""}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

export function listingIdentityKey(listing: DiscoveredJobListing): string {
  const indeedKey = listing.jobKey ?? extractIndeedJobKey(listing.url);
  if (indeedKey) return `indeed:${indeedKey}`;

  const linkedInId = extractLinkedInJobId(listing.url);
  if (linkedInId) return `linkedin:${linkedInId}`;

  return `url:${normalizeJobUrl(listing.url)}`;
}

export function jobIdentityKey(job: Job): string {
  const indeedKey = extractIndeedJobKey(job.applicationUrl);
  if (indeedKey) return `indeed:${indeedKey}`;

  const linkedInId = extractLinkedInJobId(job.applicationUrl);
  if (linkedInId) return `linkedin:${linkedInId}`;

  return `url:${normalizeJobUrl(job.applicationUrl)}`;
}

export function stableJobId(userId: string, identityKey: string): string {
  const hash = createHash("sha256")
    .update(`${userId}:${identityKey}`)
    .digest("hex")
    .slice(0, 16);
  return `job_${hash}`;
}
