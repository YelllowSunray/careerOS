import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { uploadBuffer } from "@/services/storage";
import { getProfile, saveProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import {
  getResumeMimeType,
  isAllowedResumeFile,
  resumeFileTypeLabel,
} from "@/lib/resume/files";

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return jsonError("No file provided");

    if (!isAllowedResumeFile(file.name)) {
      return jsonError(`Invalid file type. Please upload a ${resumeFileTypeLabel()}.`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const storagePath = `resumes/${userId}/${safeName}`;
    const contentType = file.type || getResumeMimeType(file.name);
    await uploadBuffer(storagePath, buffer, contentType);

    const profile = await getProfile(userId);
    const updated = {
      ...profile,
      userId,
      name: profile?.name ?? "",
      email: profile?.email ?? "",
      portfolioUrls: profile?.portfolioUrls ?? [],
      preferredCountries: profile?.preferredCountries ?? [],
      workPreference: profile?.workPreference ?? ("any" as const),
      onboardingComplete: profile?.onboardingComplete ?? false,
      settings: profile?.settings ?? { fitScoreThreshold: 85, autoApply: false },
      resume: {
        storagePath,
        fileName: safeName,
        contentType,
        uploadedAt: nowIso(),
      },
      updatedAt: nowIso(),
    };
    await saveProfile(updated);

    return jsonOk({ storagePath, fileName: safeName, contentType });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Upload failed", 500);
  }
}
