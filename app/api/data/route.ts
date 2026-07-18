import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import {
  getCandidateProfile,
  getResume,
  getApplications,
  getJobs,
  getJobMatches,
} from "@/services/firestore";
import { getAiUsage } from "@/services/ai-usage";

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const type = request.nextUrl.searchParams.get("type");

    switch (type) {
      case "candidate":
        return jsonOk(await getCandidateProfile(userId));
      case "resume":
        return jsonOk(await getResume(userId));
      case "jobs":
        return jsonOk(await getJobs(userId));
      case "matches":
        return jsonOk(await getJobMatches(userId));
      case "applications":
        return jsonOk(await getApplications(userId));
      case "ai-usage":
        return jsonOk(await getAiUsage(userId));
      default:
        return jsonError("Invalid type parameter");
    }
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError("Failed to fetch data", 500);
  }
}
