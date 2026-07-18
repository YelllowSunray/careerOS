import { NextRequest, after } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { orchestrator } from "@/agents/core/orchestrator";
import { getJob } from "@/services/firestore";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = await request.json();
    const jobId = body.jobId as string | undefined;

    if (!jobId?.trim()) {
      return jsonError("jobId is required", 400);
    }

    const job = await getJob(jobId);
    if (!job || job.userId !== userId) {
      return jsonError("Job not found", 404);
    }

    after(async () => {
      try {
        await orchestrator.runApplyToJob(userId, jobId);
      } catch (e) {
        console.error(`[Apply] Background apply failed (${jobId}):`, e);
      }
    });

    return jsonOk({
      jobId,
      applicationId: `app_${jobId}`,
      status: "applying",
      message:
        "Application started — generating cover letter and filling the form with AI",
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Apply failed", 500);
  }
}
