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

    // Deepen CareerIntent from confirmed learn feedback.
    if (mode === "learn" && body.review) {
      try {
        const { getProfile, saveProfile } = await import("@/services/firestore");
        const { nowIso } = await import("@/lib/utils/dates");
        const profile = await getProfile(userId);
        if (profile) {
          const theme = body.review.theme;
          const anti: string[] = [];
          if (theme === "wrong_craft" || theme === "too_senior") {
            anti.push(body.review.constraintSummary || reason.slice(0, 160));
          }
          if (theme === "location_commute") {
            anti.push(body.review.constraintSummary || "Avoid roles outside preferred location/commute");
          }
          const prev = profile.careerIntent;
          const careerIntent = {
            northStar: prev?.northStar || profile.targetRoles?.primary || "Next role",
            narrative: prev?.narrative || profile.jobPreferences || "",
            antiGoals: [
              ...new Set([...(prev?.antiGoals ?? []), ...anti]),
            ].slice(0, 12),
            workSetting: prev?.workSetting ?? ("flexible" as const),
            horizon: prev?.horizon ?? { now: [], sixMonths: [], twoYears: [] },
            stretchTolerance: prev?.stretchTolerance ?? ("show_stretch" as const),
            moneyFloor: prev?.moneyFloor,
            nonNegotiables: [
              ...new Set([
                ...(prev?.nonNegotiables ?? []),
                body.review.constraintSummary,
              ]),
            ].slice(0, 12),
            openQuestions: prev?.openQuestions ?? [],
            updatedAt: nowIso(),
            source: (prev?.source === "intake" ? "intake" : "manual") as
              | "intake"
              | "coach"
              | "manual"
              | "skip",
          };
          await saveProfile({
            ...profile,
            careerIntent,
            updatedAt: nowIso(),
          });
        }
      } catch (intentErr) {
        console.warn("[Feedback confirm] Intent update skipped:", intentErr);
      }
    }

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
