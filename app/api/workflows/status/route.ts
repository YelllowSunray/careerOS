import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { getLatestWorkflow, updateWorkflow } from "@/services/firestore";
import { isWorkflowStale } from "@/lib/workflows/stale";
import { nowIso } from "@/lib/utils/dates";

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const type = request.nextUrl.searchParams.get("type") ?? "process_profile";
    let workflow = await getLatestWorkflow(
      userId,
      type as "process_profile" | "find_jobs" | "apply_jobs"
    );

    if (workflow && isWorkflowStale(workflow)) {
      await updateWorkflow(workflow.id, {
        status: "failed",
        error: "Processing timed out",
        completedAt: nowIso(),
      });
      workflow = { ...workflow, status: "failed", error: "Processing timed out" };
    }

    return jsonOk(workflow);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError("Failed to fetch workflow", 500);
  }
}
