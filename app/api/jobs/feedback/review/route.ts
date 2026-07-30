import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import { reviewJobFeedback } from "@/agents/tools/job-feedback";
import { getJob, getJobMatch } from "@/services/firestore";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI reviews a dislike before learning — may push back on "too senior" etc. */
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = (await request.json()) as {
      jobId?: string;
      reason?: string;
      reasonHint?: string;
    };

    const jobId = String(body.jobId ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!jobId || !reason) {
      return jsonError("jobId and reason are required", 400);
    }

    const job = await getJob(jobId);
    if (!job || job.userId !== userId) {
      return jsonError("Job not found", 404);
    }

    const [context, match] = await Promise.all([
      buildCandidateContext(userId),
      getJobMatch(`match_${jobId}`),
    ]);

    const review = await reviewJobFeedback({
      context,
      job,
      match,
      reason,
      reasonHint: body.reasonHint?.trim() || undefined,
    });

    return jsonOk({
      review,
      job: { id: job.id, title: job.title, company: job.company },
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Feedback review]", e);
    return jsonError(
      e instanceof Error ? e.message : "Feedback review failed",
      500
    );
  }
}
