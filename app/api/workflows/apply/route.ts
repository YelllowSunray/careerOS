import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { orchestrator } from "@/agents/core/orchestrator";

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = await request.json();
    const applicationIds: string[] = body.applicationIds ?? [];
    if (!applicationIds.length) {
      return jsonError("No application IDs provided");
    }

    const workflow = await orchestrator.applyToJobs(userId, applicationIds);
    return jsonOk(workflow);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Apply failed", 500);
  }
}
