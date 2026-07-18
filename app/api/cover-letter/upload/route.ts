import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { uploadBuffer } from "@/services/storage";
import { getProfile, saveProfile } from "@/services/firestore";
import { extractResumeText } from "@/agents/tools/resume-text-extract";
import { nowIso } from "@/lib/utils/dates";
import {
  getResumeMimeType,
  isAllowedResumeFile,
  resumeFileTypeLabel,
} from "@/lib/resume/files";
import type { UploadedDocument, UserProfile } from "@/lib/types";

const MAX_COVER_LETTERS = 5;

function ensureProfile(userId: string, profile: UserProfile | null): UserProfile {
  return {
    ...profile,
    userId,
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    portfolioUrls: profile?.portfolioUrls ?? [],
    preferredCountries: profile?.preferredCountries ?? [],
    workPreference: profile?.workPreference ?? "any",
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
    const existing = profile.coverLetters ?? [];
    if (existing.length >= MAX_COVER_LETTERS) {
      return jsonError(`You can upload at most ${MAX_COVER_LETTERS} cover letters`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const id = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storagePath = `cover-letters/${userId}/${id}_${safeName}`;
    const contentType = file.type || getResumeMimeType(file.name);
    await uploadBuffer(storagePath, buffer, contentType);

    let rawText = "";
    try {
      rawText = await extractResumeText(storagePath, safeName, userId);
    } catch (e) {
      console.warn("[Cover letter] Text extraction failed:", e);
    }

    const sample: UploadedDocument = {
      id,
      storagePath,
      fileName: safeName,
      contentType,
      uploadedAt: nowIso(),
      rawText: rawText.trim() || undefined,
    };

    const updated: UserProfile = {
      ...profile,
      coverLetters: [...existing, sample],
      updatedAt: nowIso(),
    };
    await saveProfile(updated);

    return jsonOk({ coverLetter: sample, coverLetters: updated.coverLetters });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Upload failed", 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return jsonError("Missing cover letter id");

    const profile = await getProfile(userId);
    if (!profile) return jsonError("Profile not found", 404);

    const coverLetters = (profile.coverLetters ?? []).filter((c) => c.id !== id);
    if (coverLetters.length === (profile.coverLetters ?? []).length) {
      return jsonError("Cover letter not found", 404);
    }

    const updated: UserProfile = {
      ...profile,
      coverLetters,
      updatedAt: nowIso(),
    };
    await saveProfile(updated);

    return jsonOk({ coverLetters });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    return jsonError(e instanceof Error ? e.message : "Delete failed", 500);
  }
}
