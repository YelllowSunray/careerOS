import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { getLatestWorkflow } from "@/services/firestore";
import { pauseWorkflow } from "@/lib/workflows/pause";
import { isWorkflowStale } from "@/lib/workflows/stale";
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

    const paused = await pauseWorkflow(workflow.id);
    return jsonOk({ workflow: paused, status: "paused" });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Failed to pause workflow", 500);
  }
}
