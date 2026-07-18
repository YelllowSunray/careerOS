import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { orchestrator } from "@/agents/core/orchestrator";
import { getLatestWorkflow, getProfile } from "@/services/firestore";
import { isWorkflowStale } from "@/lib/workflows/stale";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const profile = await getProfile(userId);
    const threshold =
      profile?.settings.fitScoreThreshold ??
      Number(process.env.FIT_SCORE_DEFAULT_THRESHOLD ?? 85);

    const existing = await getLatestWorkflow(userId, "find_jobs");
    if (existing?.status === "running" && !isWorkflowStale(existing)) {
      return jsonOk({
        workflowId: existing.id,
        status: "running",
        workflow: existing,
      });
    }

    const workflow = await orchestrator.startFindJobs(userId, threshold);

    // Fire-and-forget so continuous search is not capped by route maxDuration /
    // after(). Pause is the only intentional stop.
    void orchestrator.runFindJobs(userId, workflow.id, threshold).catch((e) => {
      console.error(`[Find jobs] Background workflow failed (${workflow.id}):`, e);
    });

    return jsonOk({
      workflowId: workflow.id,
      status: "running",
      workflow,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Find jobs failed", 500);
  }
}
