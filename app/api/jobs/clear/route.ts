import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import {
  clearUserJobSearchResults,
  getLatestWorkflow,
} from "@/services/firestore";
import { isWorkflowActive } from "@/lib/workflows/stale";

export async function DELETE(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return jsonError("Not available in production", 403);
  }

  try {
    const userId = await verifyAuth(request);
    const running = await getLatestWorkflow(userId, "find_jobs");
    if (isWorkflowActive(running)) {
      return jsonError("Pause the running job search before clearing results", 409);
    }

    await clearUserJobSearchResults(userId);
    return jsonOk({ cleared: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Failed to clear results", 500);
  }
}
