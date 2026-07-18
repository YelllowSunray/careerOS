import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { getLatestWorkflow, updateWorkflow } from "@/services/firestore";
import { pauseWorkflow } from "@/lib/workflows/pause";
import { isOrphanedFindJobs } from "@/lib/workflows/live";
import { isWorkflowStale } from "@/lib/workflows/stale";
import { nowIso } from "@/lib/utils/dates";
import type { WorkflowType } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = await request.json().catch(() => ({}));
    const type = (body.type ?? "find_jobs") as WorkflowType;

    const workflow = await getLatestWorkflow(userId, type);
    if (!workflow || workflow.status !== "running") {
      return jsonError("No running workflow to pause", 400);
    }
    if (isWorkflowStale(workflow)) {
      return jsonError("Workflow has already timed out", 400);
    }

    // Orphaned after server restart — nothing to pause; mark stopped.
    if (type === "find_jobs" && isOrphanedFindJobs(workflow)) {
      const error =
        "Search stopped when the server restarted. Click Find Jobs to continue.";
      await updateWorkflow(workflow.id, {
        status: "failed",
        error,
        completedAt: nowIso(),
      });
      return jsonOk({
        workflow: { ...workflow, status: "failed", error },
        status: "failed",
      });
    }

    const paused = await pauseWorkflow(workflow.id);
    return jsonOk({ workflow: paused, status: "paused" });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Failed to pause workflow", 500);
  }
}
