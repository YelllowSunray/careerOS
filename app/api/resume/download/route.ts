import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { getProfile } from "@/services/firestore";
import { getSignedDownloadUrl } from "@/services/storage";

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const profile = await getProfile(userId);
    if (!profile?.resume?.storagePath) {
      return jsonError("No resume to download", 404);
    }

    const { storagePath, fileName } = profile.resume;
    if (!storagePath.startsWith(`resumes/${userId}/`)) {
      return jsonError("Invalid resume path", 403);
    }

    const url = await getSignedDownloadUrl(storagePath, fileName);
    return jsonOk({ url, fileName });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Download failed", 500);
  }
}
