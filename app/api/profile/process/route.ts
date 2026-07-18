import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { orchestrator } from "@/agents/core/orchestrator";
import { getLatestWorkflow, getWorkflow, updateWorkflow } from "@/services/firestore";
import { isWorkflowStale } from "@/lib/workflows/stale";
import { nowIso } from "@/lib/utils/dates";
import type { Workflow } from "@/lib/types";

export const maxDuration = 300;

async function cancelStuckWorkflow(
  workflow: Workflow,
  reason: string
): Promise<void> {
  await updateWorkflow(workflow.id, {
    status: "failed",
    error: reason,
    completedAt: nowIso(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    const existing = await getLatestWorkflow(userId, "process_profile");

    if (existing?.status === "running") {
      const stale = isWorkflowStale(existing);
      if (!force && !stale) {
        return jsonOk({ workflowId: existing.id, status: "running" });
      }
      await cancelStuckWorkflow(
        existing,
        force ? "Cancelled — new run started" : "Processing timed out"
      );
    }

    const workflow = await orchestrator.startProfileProcessing(userId);

    try {
      await orchestrator.runProfileProcessing(userId, workflow.id);
    } catch (e) {
      console.error("[Profile process] Pipeline error:", e);
      throw e;
    }

    const final = await getWorkflow(workflow.id);
    return jsonOk({
      workflowId: workflow.id,
      status: final?.status ?? "completed",
      workflow: final,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    const message = e instanceof Error ? e.message : "Processing failed";
    console.error("[Profile process] Error:", message);
    return jsonError(message, 500);
  }
}
