import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import {
  applyFeedbackConstraintsToSavedJobs,
  removeLearnedConstraint,
  resynthesizeFeedbackPreferences,
} from "@/agents/tools/job-feedback";
import {
  clearJobFeedbacks,
  deleteJobFeedback,
  getFeedbackPreferenceState,
  getJobFeedbacks,
  getJobMatches,
  saveFeedbackPreferenceState,
  saveJobMatch,
} from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const [feedbacks, preferences] = await Promise.all([
      getJobFeedbacks(userId),
      getFeedbackPreferenceState(userId),
    ]);
    return jsonOk({ feedbacks, preferences });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError("Failed to load feedback", 500);
  }
}

/** Clear all feedback, one feedback, or one learned constraint bullet. */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    let body: { id?: string; constraint?: string } = {};
    try {
      body = (await request.json()) as { id?: string; constraint?: string };
    } catch {
      // no body = clear all
    }

    if (body.constraint?.trim()) {
      const context = await buildCandidateContext(userId);
      const { state, refiltered } = await removeLearnedConstraint(
        context,
        body.constraint.trim()
      );
      return jsonOk({
        cleared: "constraint",
        constraint: body.constraint.trim(),
        preferences: state,
        refiltered,
      });
    }

    if (body.id) {
      await deleteJobFeedback(body.id);
      const remaining = await getJobFeedbacks(userId);
      const context = await buildCandidateContext(userId);
      const state = await resynthesizeFeedbackPreferences(context, remaining);
      await applyFeedbackConstraintsToSavedJobs(context, state);
      return jsonOk({ cleared: "one", id: body.id, preferences: state });
    }

    await clearJobFeedbacks(userId);
    await saveFeedbackPreferenceState({
      userId,
      learnedConstraints: [],
      guidanceSummary: "No active preference lessons from listing feedback.",
      hiddenJobIds: [],
      updatedAt: nowIso(),
    });

    // Restore all matches previously hidden by feedback.
    const matches = await getJobMatches(userId);
    for (const match of matches) {
      if (
        match.feedbackRequirementMet === false ||
        match.feedbackNotes ||
        (match.violatedFeedbackIds?.length ?? 0) > 0
      ) {
        await saveJobMatch({
          ...match,
          feedbackRequirementMet: true,
          feedbackNotes: "",
          violatedFeedbackIds: [],
        });
      }
    }

    return jsonOk({ cleared: "all" });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Feedback clear]", e);
    return jsonError(
      e instanceof Error ? e.message : "Failed to clear feedback",
      500
    );
  }
}
