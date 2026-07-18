import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import {
  generateCoverLetterForJob,
  refreshJobListingForCoverLetter,
} from "@/agents/tools/application-generate";
import { buildCandidateContext } from "@/lib/candidate/context";
import {
  getApplication,
  getJob,
  getJobMatch,
  saveApplication,
  saveJob,
} from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { Application, CoverLetterLanguage } from "@/lib/types";

export const maxDuration = 180;

function isCoverLetterLanguage(value: unknown): value is CoverLetterLanguage {
  return value === "en" || value === "nl";
}

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = await request.json().catch(() => ({}));
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const language = isCoverLetterLanguage(body.language) ? body.language : "en";

    if (!jobId) return jsonError("jobId is required", 400);

    const storedJob = await getJob(jobId);
    if (!storedJob || storedJob.userId !== userId) {
      return jsonError("Job not found", 404);
    }

    const [context, match, refreshed] = await Promise.all([
      buildCandidateContext(userId),
      getJobMatch(`match_${jobId}`),
      refreshJobListingForCoverLetter(storedJob),
    ]);

    if (!context.hasRawSources && !context.coverLetterSamplesText.trim()) {
      return jsonError(
        "Add a resume, portfolio, or cover letter sample on your profile before generating",
        400
      );
    }

    const job = refreshed.job;
    if (
      job.description !== storedJob.description ||
      JSON.stringify(job.requirements) !== JSON.stringify(storedJob.requirements)
    ) {
      await saveJob(job).catch((e) =>
        console.warn("[Cover letter] Failed to persist enriched job:", e)
      );
    }

    const { coverLetter, requirementMatches, sources } =
      await generateCoverLetterForJob(
        job,
        context,
        match,
        language,
        refreshed.listingText
      );

    const appId = `app_${jobId}`;
    const existing = await getApplication(appId);
    const now = nowIso();

    const materialsUpdate = {
      coverLetter,
      coverLetterLanguage: language,
      coverLetterSources: sources,
    };

    const application: Application = existing
      ? {
          ...existing,
          materials: {
            ...existing.materials,
            ...materialsUpdate,
          },
          jobDescription: sources.listingText.slice(0, 12000),
          updatedAt: now,
        }
      : {
          id: appId,
          userId,
          jobId,
          jobTitle: job.title,
          company: job.company,
          status: "draft",
          fitScore: match?.fitScore ?? 0,
          materials: {
            ...materialsUpdate,
            resumeSummary: "",
            customAnswers: [],
          },
          applicationUrl: job.applicationUrl,
          jobDescription: sources.listingText.slice(0, 12000),
          createdAt: now,
          updatedAt: now,
        };

    if (
      existing &&
      (existing.status === "applying" ||
        existing.status === "applied" ||
        existing.status === "interview" ||
        existing.status === "offer")
    ) {
      application.status = existing.status;
    }

    await saveApplication(application);

    return jsonOk({
      coverLetter,
      language,
      requirementMatches,
      sources,
      applicationId: application.id,
      application,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Cover letter] Generation failed:", e);
    return jsonError(
      e instanceof Error ? e.message : "Failed to generate cover letter",
      500
    );
  }
}
