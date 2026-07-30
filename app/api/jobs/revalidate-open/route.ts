import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { checkListingAvailability } from "@/agents/tools/listing-open";
import { getJobs, saveJob } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { DiscoveredJobListing } from "@/agents/tools/job-discovery";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function jobToListing(job: Job): DiscoveredJobListing {
  return {
    title: job.title,
    company: job.company,
    url: job.applicationUrl,
    location: job.location,
    platform:
      job.sourcePlatform === "indeed"
        ? "indeed"
        : job.sourcePlatform === "linkedin"
          ? "linkedin"
          : "career_page",
    snippet: job.description?.slice(0, 500),
  };
}

/**
 * Re-check saved jobs for dead links / closed applications.
 * Archives jobs that are clearly no longer applyable.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const jobs = (await getJobs(userId)).filter(
      (j) => j.status !== "archived"
    );

    // Cap per request to control cost/latency
    const toCheck = jobs.slice(0, 25);
    let archived = 0;
    let checked = 0;

    for (const job of toCheck) {
      // Skip if checked recently (6 hours)
      if (job.listingOpenCheckedAt) {
        const age =
          Date.now() - new Date(job.listingOpenCheckedAt).getTime();
        if (age < 6 * 60 * 60 * 1000 && job.listingOpenStatus === "open") {
          continue;
        }
      }

      checked++;
      const availability = await checkListingAvailability({
        listing: jobToListing(job),
        postingText: `${job.title}\n${job.company}\n${job.description || ""}`,
        userId,
      });

      if (!availability.acceptingApplications) {
        await saveJob({
          ...job,
          status: "archived",
          listingOpenStatus: availability.status,
          listingOpenNotes: availability.reason,
          listingOpenCheckedAt: nowIso(),
        });
        archived++;
        console.log(
          `[Jobs revalidate] Archived (${availability.status}): ${job.title} @ ${job.company} — ${availability.reason}`
        );
      } else {
        await saveJob({
          ...job,
          listingOpenStatus: "open",
          listingOpenNotes: availability.reason,
          listingOpenCheckedAt: nowIso(),
        });
      }
    }

    return jsonOk({ checked, archived, remaining: jobs.length - checked });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Jobs revalidate]", e);
    return jsonError(
      e instanceof Error ? e.message : "Failed to revalidate jobs",
      500
    );
  }
}
