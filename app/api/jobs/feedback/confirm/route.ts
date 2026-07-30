import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import { confirmJobFeedback } from "@/agents/tools/job-feedback";
import type { FeedbackReviewResult } from "@/lib/types";
import { getJob, getJobMatch } from "@/services/firestore";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Confirm hide+learn or hide-only after AI review. */
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = (await request.json()) as {
      jobId?: string;
      reason?: string;
      reasonHint?: string;
      mode?: "learn" | "hide_only";
      review?: FeedbackReviewResult;
    };

    const jobId = String(body.jobId ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const mode = body.mode === "hide_only" ? "hide_only" : "learn";
    if (!jobId || !reason || !body.review) {
      return jsonError("jobId, reason, and review are required", 400);
    }

    const job = await getJob(jobId);
    if (!job || job.userId !== userId) {
      return jsonError("Job not found", 404);
    }

    const [context, match] = await Promise.all([
      buildCandidateContext(userId),
      getJobMatch(`match_${jobId}`),
    ]);

    const result = await confirmJobFeedback({
      context,
      job,
      match,
      reason,
      reasonHint: body.reasonHint?.trim() || undefined,
      review: body.review,
      mode,
    });

    return jsonOk(result);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Feedback confirm]", e);
    return jsonError(
      e instanceof Error ? e.message : "Feedback confirm failed",
      500
    );
  }
}
