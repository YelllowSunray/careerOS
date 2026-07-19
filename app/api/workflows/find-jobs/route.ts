import { NextRequest, after } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { orchestrator } from "@/agents/core/orchestrator";
import { getLatestWorkflow, getProfile, updateWorkflow } from "@/services/firestore";
import { markFindJobsDone, markFindJobsLive } from "@/lib/workflows/live";
import { isOrphanedFindJobs, isWorkflowStale } from "@/lib/workflows/stale";
import { nowIso } from "@/lib/utils/dates";

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
      if (!isOrphanedFindJobs(existing)) {
        return jsonOk({
          workflowId: existing.id,
          status: "running",
          workflow: existing,
        });
      }
      await updateWorkflow(existing.id, {
        status: "failed",
        error:
          "Search stopped when the server restarted. Starting a new search.",
        completedAt: nowIso(),
      });
      console.warn(
        `[Find jobs] Replacing orphaned workflow ${existing.id} with a new run`
      );
    }

    const workflow = await orchestrator.startFindJobs(userId, threshold);
    markFindJobsLive(workflow.id);

    const run = async () => {
      try {
        await orchestrator.runFindJobs(userId, workflow.id, threshold);
      } catch (e) {
        console.error(
          `[Find jobs] Background workflow failed (${workflow.id}):`,
          e
        );
      } finally {
        markFindJobsDone(workflow.id);
      }
    };

    // Vercel freezes the isolate after the response unless after()/waitUntil is used.
    // Locally prefer void so HMR doesn't confuse orphan detection as easily.
    if (process.env.VERCEL) {
      after(run);
    } else {
      void run();
    }

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
