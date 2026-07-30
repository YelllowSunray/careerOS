import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { uploadBuffer, deleteBuffer } from "@/services/storage";
import {
  deleteCandidateProfile,
  deleteResume,
  getProfile,
  saveProfile,
} from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import {
  getResumeMimeType,
  isAllowedResumeFile,
  resumeFileTypeLabel,
} from "@/lib/resume/files";
import type { UserProfile } from "@/lib/types";
import { normalizeWorkPreferences } from "@/lib/job-search/work-preference";

function ensureProfile(userId: string, profile: UserProfile | null): UserProfile {
  return {
    ...profile,
    userId,
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    portfolioUrls: profile?.portfolioUrls ?? [],
    preferredCountries: profile?.preferredCountries ?? [],
    workPreferences: normalizeWorkPreferences(profile ?? {}),
    onboardingComplete: profile?.onboardingComplete ?? false,
    settings: profile?.settings ?? { fitScoreThreshold: 85, autoApply: false },
    coverLetters: profile?.coverLetters ?? [],
    updatedAt: nowIso(),
  };
}

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return jsonError("No file provided");

    if (!isAllowedResumeFile(file.name)) {
      return jsonError(`Invalid file type. Please upload a ${resumeFileTypeLabel()}.`);
    }

    const profile = ensureProfile(userId, await getProfile(userId));
    const previousPath = profile.resume?.storagePath;

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const storagePath = `resumes/${userId}/${safeName}`;
    const contentType = file.type || getResumeMimeType(file.name);
    await uploadBuffer(storagePath, buffer, contentType);

    const updated: UserProfile = {
      ...profile,
      resume: {
        storagePath,
        fileName: safeName,
        contentType,
        uploadedAt: nowIso(),
      },
      updatedAt: nowIso(),
    };
    await saveProfile(updated);

    if (previousPath && previousPath !== storagePath) {
      await deleteBuffer(previousPath);
    }

    return jsonOk({
      storagePath,
      fileName: safeName,
      contentType,
      resume: updated.resume,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Upload failed", 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const profile = await getProfile(userId);
    if (!profile?.resume?.storagePath) {
      return jsonError("No resume to delete", 404);
    }

    const storagePath = profile.resume.storagePath;
    await deleteBuffer(storagePath);
    await Promise.all([deleteResume(userId), deleteCandidateProfile(userId)]);

    const updated: UserProfile = {
      ...profile,
      resume: undefined,
      updatedAt: nowIso(),
    };
    await saveProfile(updated);

    return jsonOk({ deleted: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Delete failed", 500);
  }
}
