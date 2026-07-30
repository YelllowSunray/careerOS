"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ProfileDetailsCard } from "@/components/profile/profile-details-card";
import { TargetRolesSection } from "@/components/profile/target-roles-section";
import type { UserProfile, CandidateProfile, ResumeData, Workflow, FeedbackPreferenceState } from "@/lib/types";
import type { AiUsageRecord } from "@/lib/types/ai-usage";
import {
  AI_USAGE_CATEGORY_LABELS,
  getCategoryTotals,
  type AiUsageCategory,
} from "@/lib/ai-usage/categories";
import { isWorkflowActive, logWorkflowToConsole } from "@/lib/workflows/stale";
import { Download, FileText, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { RESUME_ACCEPT, isAllowedResumeFile, resumeFileTypeLabel } from "@/lib/resume/files";

export default function ProfilePage() {
  const { apiFetch } = useApi();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [candidate, setCandidate] = useState<CandidateProfile | null>(null);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [downloadingResume, setDownloadingResume] = useState(false);
  const [deletingResume, setDeletingResume] = useState(false);
  const [uploadingCoverLetter, setUploadingCoverLetter] = useState(false);
  const [deletingCoverLetterId, setDeletingCoverLetterId] = useState<string | null>(null);
  const [feedbackPrefs, setFeedbackPrefs] =
    useState<FeedbackPreferenceState | null>(null);
  const [removingConstraint, setRemovingConstraint] = useState<string | null>(null);

  const logError = (label: string, e: unknown) => {
    console.error(`[Profile] ${label}:`, e);
  };

  const loadData = useCallback(async () => {
    setProfileLoadError(null);
    const [p, c, r, w, u, fb] = await Promise.all([
      apiFetch("/api/profile").catch((e) => {
        const message = e instanceof Error ? e.message : "Failed to load profile";
        logError("load profile", e);
        setProfileLoadError(message);
        return null;
      }),
      apiFetch("/api/data?type=candidate").catch((e) => {
        logError("load candidate", e);
        return null;
      }),
      apiFetch("/api/data?type=resume").catch((e) => {
        logError("load resume", e);
        return null;
      }),
      apiFetch("/api/workflows/status?type=process_profile").catch((e) => {
        logError("load workflow status", e);
        return null;
      }),
      apiFetch("/api/data?type=ai-usage").catch((e) => {
        logError("load ai usage", e);
        return null;
      }),
      apiFetch("/api/jobs/feedback").catch((e) => {
        logError("load feedback preferences", e);
        return null;
      }),
    ]);
    setProfile(p);
    setCandidate(c);
    setResume(r);
    setWorkflow(w);
    setAiUsage(u);
    setFeedbackPrefs(
      (fb as { preferences?: FeedbackPreferenceState | null } | null)?.preferences ??
        null
    );

    if (w && (w.status === "failed" || w.error)) {
      logWorkflowToConsole(w, "Processing");
    }

    return { p, c, r, w, u };
  }, [apiFetch]);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Auto-start AI extraction if profile exists but hasn't been analyzed yet
  useEffect(() => {
    if (loading || !profile?.onboardingComplete) return;
    if (!profile.resume && profile.portfolioUrls.length === 0) return;
    if (isWorkflowActive(workflow)) return;

    const hasRawResume = (resume?.rawText?.trim().length ?? 0) > 0;
    const summaryFailed = workflow?.steps?.some(
      (s) => s.name === "candidate_profile" && s.status === "failed"
    );
    // Resume ingested and summary ok (or we already have a cached profile) — nothing to do.
    if (hasRawResume && workflow?.status === "completed" && (!summaryFailed || candidate)) {
      return;
    }
    if (workflow?.status === "completed" && candidate && !summaryFailed) return;

    apiFetch("/api/profile/process", {
      method: "POST",
      body: JSON.stringify(summaryFailed && !candidate ? { force: true } : {}),
    })
      .then((result) => {
        if (result?.workflow) logWorkflowToConsole(result.workflow, "Auto-start");
        return loadData();
      })
      .catch((e) => console.error("[Profile] auto-start processing failed:", e));
  }, [loading, profile, candidate, resume, workflow, apiFetch, loadData]);

  const isProcessing = isWorkflowActive(workflow);

  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => {
      loadData();
    }, 4000);
    return () => clearInterval(interval);
  }, [isProcessing, loadData]);

  async function handleReprocess() {
    setReprocessing(true);
    try {
      const result = await apiFetch("/api/profile/process", {
        method: "POST",
        body: JSON.stringify({ force: true }),
      });
      if (result?.workflow) logWorkflowToConsole(result.workflow, "Re-analyze");
      if (result?.status === "failed") {
        console.error("[Profile] Re-analyze completed with failure:", result.workflow?.error);
      }
      await loadData();
    } catch (e) {
      console.error("[Profile] Re-analyze failed:", e);
    } finally {
      setReprocessing(false);
    }
  }

  async function handleSaveProfile(update: Partial<UserProfile>) {
    const updated = await apiFetch("/api/profile", {
      method: "PUT",
      body: JSON.stringify(update),
    });
    setProfile(updated);
  }

  async function handleResumeUpload(file: File | null) {
    if (!file) return;
    if (!isAllowedResumeFile(file.name)) {
      alert(`Please upload a ${resumeFileTypeLabel()}.`);
      return;
    }

    setUploadingResume(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiFetch("/api/resume/upload", {
        method: "POST",
        body: formData,
      });

      const result = await apiFetch("/api/profile/process", {
        method: "POST",
        body: JSON.stringify({ force: true }),
      });
      if (result?.workflow) logWorkflowToConsole(result.workflow, "Resume upload");

      setResume(null);
      setCandidate(null);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to upload resume");
    } finally {
      setUploadingResume(false);
    }
  }

  async function handleDownloadResume() {
    if (!profile?.resume) return;
    setDownloadingResume(true);
    try {
      const result = await apiFetch<{ url: string; fileName: string }>(
        "/api/resume/download"
      );
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to download resume");
    } finally {
      setDownloadingResume(false);
    }
  }

  async function handleDeleteResume() {
    if (!profile?.resume) return;
    if (
      !confirm(
        "Remove your resume? AI skills, ladder, and extracted profile data will be cleared until you upload a new CV."
      )
    ) {
      return;
    }

    setDeletingResume(true);
    try {
      await apiFetch("/api/resume/upload", { method: "DELETE" });
      setResume(null);
      setCandidate(null);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete resume");
    } finally {
      setDeletingResume(false);
    }
  }

  async function handleCoverLetterUpload(file: File | null) {
    if (!file) return;
    if (!isAllowedResumeFile(file.name)) {
      alert(`Please upload a ${resumeFileTypeLabel()}.`);
      return;
    }

    setUploadingCoverLetter(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch("/api/cover-letter/upload", {
        method: "POST",
        body: formData,
      });
      if (profile) {
        setProfile({
          ...profile,
          coverLetters: result.coverLetters ?? profile.coverLetters,
        });
      } else {
        await loadData();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to upload cover letter");
    } finally {
      setUploadingCoverLetter(false);
    }
  }

  async function handleDeleteCoverLetter(id: string) {
    if (!confirm("Remove this cover letter sample?")) return;
    setDeletingCoverLetterId(id);
    try {
      const result = await apiFetch(`/api/cover-letter/upload?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (profile) {
        setProfile({
          ...profile,
          coverLetters: result.coverLetters ?? [],
        });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete cover letter");
    } finally {
      setDeletingCoverLetterId(null);
    }
  }

  async function handleRemoveSearchFilter(constraint: string) {
    if (
      !confirm(
        `Remove this search filter?\n\n"${constraint}"\n\nMatching jobs (e.g. consulting) can show up again in Jobs, and new searches will allow them.`
      )
    ) {
      return;
    }
    setRemovingConstraint(constraint);
    try {
      const result = (await apiFetch("/api/jobs/feedback", {
        method: "DELETE",
        body: JSON.stringify({ constraint }),
      })) as { preferences?: FeedbackPreferenceState };
      setFeedbackPrefs(result.preferences ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove filter");
    } finally {
      setRemovingConstraint(null);
    }
  }

  if (loading) {
    return <div className="text-zinc-500">Loading profile...</div>;
  }

  if (profileLoadError) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-2xl font-semibold">Couldn’t load your profile</h1>
        <p className="mt-2 text-sm text-zinc-500">{profileLoadError}</p>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-left text-sm text-zinc-600">
          <p className="font-medium text-zinc-900">Fix on Vercel</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>
              Set <code className="rounded bg-white px-1">FIREBASE_SERVICE_ACCOUNT_JSON</code> to
              the service-account JSON (starts with <code className="rounded bg-white px-1">{"{"}</code>)
              or its base64 form (starts with <code className="rounded bg-white px-1">ewog</code>) —
              not an <code className="rounded bg-white px-1">sk_live_</code> key.
            </li>
            <li>Redeploy after changing env vars.</li>
            <li>
              Open <code className="rounded bg-white px-1">/api/health/firebase</code> — it should
              return JSON like <code className="rounded bg-white px-1">{`{"ok":true}`}</code>.
            </li>
            <li>
              If that URL shows a Vercel login/HTML page, disable Deployment Protection for this
              project (or allow the bypass).
            </li>
          </ol>
        </div>
        <Button className="mt-6" variant="secondary" onClick={() => {
          setLoading(true);
          loadData().finally(() => setLoading(false));
        }}>
          Retry
        </Button>
      </div>
    );
  }

  if (!profile?.onboardingComplete) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-2xl font-semibold">Complete your profile</h1>
        <p className="mt-2 text-zinc-500">
          Set up your profile so the AI can discover and apply to jobs for you.
        </p>
        <Link href="/onboarding">
          <Button className="mt-6">Start onboarding</Button>
        </Link>
      </div>
    );
  }

  if (profile && !profile.careerIntent) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-2xl font-semibold">Career conversation</h1>
        <p className="mt-2 text-zinc-500">
          Tell Career OS what you want to become — we&apos;ll build Dream, Bridge,
          and Never search lanes before hunting jobs.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/intake">
            <Button>Start conversation</Button>
          </Link>
          <Button
            variant="secondary"
            onClick={async () => {
              await apiFetch("/api/intake/chat", {
                method: "POST",
                body: JSON.stringify({ action: "skip" }),
              });
              await loadData();
            }}
          >
            Skip for now
          </Button>
        </div>
      </div>
    );
  }

  const hasRawResume = (resume?.rawText?.trim().length ?? 0) > 0;
  const summaryStepFailed = workflow?.steps?.some(
    (s) => s.name === "candidate_profile" && s.status === "failed"
  );
  // Only warn when we still lack a usable candidate summary.
  const optionalSummaryFailed =
    workflow?.status === "completed" && summaryStepFailed && !candidate;
  const skills = candidate?.skills?.length
    ? candidate.skills
    : resume?.extracted.skills ?? [];
  const technologies = candidate?.technologies?.length
    ? candidate.technologies
    : resume?.extracted.technologies ?? [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-sm text-zinc-500 sm:text-base">Your AI-built candidate knowledge graph</p>
        </div>
        <Button
          variant="secondary"
          onClick={handleReprocess}
          disabled={reprocessing || isProcessing}
          className="w-full sm:w-auto sm:shrink-0"
        >
          {reprocessing || isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {isProcessing ? "Processing..." : "Re-analyze"}
        </Button>
      </div>

      {optionalSummaryFailed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            Resume text was saved, but the optional AI summary step did not complete.
            Job matching and applications still use your raw resume and portfolio.
          </p>
          <button
            type="button"
            onClick={handleReprocess}
            disabled={reprocessing || isProcessing}
            className="mt-2 font-medium underline underline-offset-2 hover:no-underline disabled:opacity-50"
          >
            Retry AI summary
          </button>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          AI is extracting skills, technologies, and roles from your resume
          {profile.portfolioUrls.length > 0 ? " and portfolio sites" : ""}...
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileDetailsCard
          profile={profile}
          phoneDisplay={resume?.extracted.phoneNumber}
          isProcessing={isProcessing}
          onSave={handleSaveProfile}
        />

        <Card>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Gemini AI usage
          </CardTitle>
          {aiUsage ? (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Total tokens</dt>
                <dd className="font-medium">{aiUsage.totalTokens.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Input tokens</dt>
                <dd>{aiUsage.promptTokens.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Output tokens</dt>
                <dd>{aiUsage.completionTokens.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">API requests</dt>
                <dd>{aiUsage.requestCount}</dd>
              </div>
              <div className="flex justify-between border-t border-zinc-100 pt-2">
                <dt className="text-zinc-500">Est. cost</dt>
                <dd className="font-medium">${aiUsage.estimatedCostUsd.toFixed(4)}</dd>
              </div>
              {(() => {
                const byCategory = getCategoryTotals(aiUsage);
                const categories = (
                  ["profile", "job_search", "application"] as AiUsageCategory[]
                ).filter((c) => byCategory[c].requestCount > 0);
                if (categories.length === 0) return null;
                return (
                  <div className="border-t border-zinc-100 pt-2">
                    <dt className="mb-2 text-zinc-500">By feature</dt>
                    <ul className="space-y-2 text-sm">
                      {categories.map((category) => {
                        const stats = byCategory[category];
                        return (
                          <li key={category} className="flex justify-between gap-2">
                            <span className="text-zinc-600">
                              {AI_USAGE_CATEGORY_LABELS[category]}
                            </span>
                            <span className="shrink-0 text-zinc-500">
                              {stats.totalTokens.toLocaleString()} tok · $
                              {stats.estimatedCostUsd.toFixed(4)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}
              {aiUsage.recentCalls.length > 0 && (
                <div className="pt-2">
                  <dt className="mb-1 text-zinc-500">Recent calls</dt>
                  <ul className="space-y-1 text-xs text-zinc-600">
                    {aiUsage.recentCalls.slice(0, 5).map((call, i) => (
                      <li key={`${call.at}-${i}`} className="flex justify-between gap-2">
                        <span className="truncate">
                          {call.operation.replace(/_/g, " ")}
                          {call.category === "job_search" && (
                            <span className="text-violet-500"> · search</span>
                          )}
                        </span>
                        <span className="shrink-0 text-zinc-400">{call.totalTokens} tok</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No AI usage yet. Run Re-analyze or Find Jobs to start.
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Resume</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">
            Upload a new version anytime — AI will re-extract skills and your career ladder.
          </p>
          {profile.resume ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
                <div className="text-sm">
                  <p className="font-medium">{profile.resume.fileName}</p>
                  <p className="text-zinc-500">
                    Uploaded {new Date(profile.resume.uploadedAt).toLocaleDateString()}
                  </p>
                  {hasRawResume && (
                    <p className="mt-1 text-emerald-600">Resume text ingested</p>
                  )}
                  {candidate && (
                    <p className="text-violet-600">AI summary available</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 self-start">
                <Button
                  variant="ghost"
                  className="px-2 text-zinc-500 hover:text-zinc-900"
                  disabled={
                    downloadingResume || deletingResume || uploadingResume || isProcessing
                  }
                  onClick={() => void handleDownloadResume()}
                  aria-label="Download resume"
                >
                  {downloadingResume ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 text-zinc-500 hover:text-red-600"
                  disabled={deletingResume || uploadingResume || downloadingResume || isProcessing}
                  onClick={() => void handleDeleteResume()}
                  aria-label="Remove resume"
                >
                  {deletingResume ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No resume uploaded</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept={RESUME_ACCEPT}
                disabled={uploadingResume || deletingResume || isProcessing}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void handleResumeUpload(file);
                }}
              />
              <span
                className={`inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition-colors ${
                  uploadingResume || deletingResume || isProcessing
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-zinc-50"
                }`}
              >
                {uploadingResume ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploadingResume
                  ? "Uploading…"
                  : profile.resume
                    ? "Replace resume"
                    : "Upload resume"}
              </span>
            </label>
            <p className="text-xs text-zinc-400">{resumeFileTypeLabel()}</p>
          </div>

          {profile.linkedInUrl && (
            <div className="mt-4 border-t border-zinc-100 pt-4 text-sm">
              <p className="font-medium text-zinc-800">LinkedIn profile</p>
              <p className="mt-1 break-all text-zinc-500">{profile.linkedInUrl}</p>
              {candidate?.sources?.linkedin ? (
                <p className="mt-1 text-emerald-600">
                  LinkedIn profile ingested — used for job matching
                </p>
              ) : (
                <p className="mt-1 text-amber-700">
                  Not ingested yet — click Re-analyze (sign in via Apply once if LinkedIn blocks guests)
                </p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Cover letters</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">
            Upload past cover letters as style references. When applying, AI writes a new letter for each job using your voice and structure — not a copy of these samples.
          </p>

          <div className="mt-4 space-y-3">
            {(profile.coverLetters ?? []).length === 0 ? (
              <p className="text-sm text-zinc-500">No cover letter samples yet</p>
            ) : (
              <ul className="space-y-2">
                {(profile.coverLetters ?? []).map((letter) => (
                  <li
                    key={letter.id}
                    className="flex flex-col gap-2 rounded-lg border border-zinc-100 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{letter.fileName}</p>
                        <p className="text-zinc-500">
                          Uploaded {new Date(letter.uploadedAt).toLocaleDateString()}
                          {letter.rawText?.trim()
                            ? " · text ready"
                            : " · text extraction pending"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      className="shrink-0 px-2 text-zinc-500 hover:text-red-600"
                      disabled={deletingCoverLetterId === letter.id}
                      onClick={() => handleDeleteCoverLetter(letter.id)}
                      aria-label={`Remove ${letter.fileName}`}
                    >
                      {deletingCoverLetterId === letter.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <label className="inline-flex cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept={RESUME_ACCEPT}
                disabled={uploadingCoverLetter || (profile.coverLetters?.length ?? 0) >= 5}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void handleCoverLetterUpload(file);
                }}
              />
              <span
                className={`inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition-colors ${
                  uploadingCoverLetter || (profile.coverLetters?.length ?? 0) >= 5
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-zinc-50"
                }`}
              >
                {uploadingCoverLetter ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploadingCoverLetter ? "Uploading…" : "Upload cover letter"}
              </span>
            </label>
            <p className="text-xs text-zinc-400">
              PDF or Word · up to 5 files
            </p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Search filters you taught</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">
            Lessons from &quot;Not a fit — teach AI&quot; on Jobs. These hide matching
            listings and steer new searches. Remove a filter to let those roles
            show again.
          </p>
          {feedbackPrefs?.guidanceSummary &&
            (feedbackPrefs.learnedConstraints?.length ?? 0) > 0 && (
              <p className="mt-3 text-sm text-zinc-600">
                {feedbackPrefs.guidanceSummary}
              </p>
            )}
          {(feedbackPrefs?.learnedConstraints?.length ?? 0) > 0 ? (
            <ul className="mt-3 space-y-2">
              {feedbackPrefs!.learnedConstraints.map((c) => (
                <li
                  key={c}
                  className="flex items-start justify-between gap-3 rounded-lg border border-zinc-100 px-3 py-2 text-sm"
                >
                  <span className="text-zinc-800">{c}</span>
                  <Button
                    variant="ghost"
                    className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                    disabled={removingConstraint === c}
                    onClick={() => void handleRemoveSearchFilter(c)}
                  >
                    {removingConstraint === c ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Remove
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              No active filters yet. On Jobs, open a match and use{" "}
              <Link href="/jobs" className="font-medium text-zinc-800 underline">
                Not a fit — teach AI
              </Link>
              .
            </p>
          )}
          {feedbackPrefs?.experienceCeiling && (
            <p className="mt-2 text-xs text-zinc-500">
              Soft search ceiling: {feedbackPrefs.experienceCeiling}
            </p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Career ladder</CardTitle>
          {candidate?.careerLadder ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Current
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {candidate.careerLadder.currentRole}
                </p>
                <p className="mt-1 text-sm text-zinc-600">
                  {candidate.careerLadder.summary}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Next roles (steps)
                </p>
                <ul className="mt-2 space-y-3">
                  {candidate.careerLadder.nextRoles.map((r) => (
                    <li
                      key={`next-${r.title}`}
                      className="rounded-lg border border-zinc-100 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{r.title}</span>
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase text-sky-800">
                          {r.branch}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-600">
                        <span className="font-medium text-zinc-800">Scope: </span>
                        {r.whyScopeIncreases || "—"}
                      </p>
                      {r.transferableStrengths.length > 0 && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Transfer: {r.transferableStrengths.join("; ")}
                        </p>
                      )}
                      {r.gapsToClose.length > 0 && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Gaps: {r.gapsToClose.join("; ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Stretch (~1–2 years)
                </p>
                <ul className="mt-2 space-y-3">
                  {candidate.careerLadder.stretchRoles.map((r) => (
                    <li
                      key={`stretch-${r.title}`}
                      className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{r.title}</span>
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase text-violet-800">
                          {r.branch}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-600">
                        <span className="font-medium text-zinc-800">Scope: </span>
                        {r.whyScopeIncreases || "—"}
                      </p>
                      {r.transferableStrengths.length > 0 && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Transfer: {r.transferableStrengths.join("; ")}
                        </p>
                      )}
                      {r.gapsToClose.length > 0 && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Gaps: {r.gapsToClose.join("; ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : isProcessing ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Building ladder map…
            </p>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No ladder yet. Click Re-analyze to generate next and stretch destinations.
            </p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Next certifications & education</CardTitle>
          {candidate?.educationRecommendations?.length ? (
            <div className="mt-4 space-y-3">
              {candidate.educationRecommendationsSummary && (
                <p className="text-sm text-zinc-600">
                  {candidate.educationRecommendationsSummary}
                </p>
              )}
              <ul className="space-y-3">
                {candidate.educationRecommendations.map((rec) => (
                  <li
                    key={`${rec.priority}-${rec.title}`}
                    className="rounded-lg border border-zinc-100 px-3 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase text-zinc-600">
                        #{rec.priority}
                      </span>
                      <span className="font-medium">{rec.title}</span>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium uppercase text-indigo-800">
                        {rec.type}
                      </span>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase text-sky-800">
                        {rec.horizon}
                      </span>
                      {rec.provider && (
                        <span className="text-xs text-zinc-500">{rec.provider}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">{rec.rationale}</p>
                    {rec.closesGaps.length > 0 && (
                      <p className="mt-1 text-xs text-zinc-500">
                        Closes: {rec.closesGaps.join("; ")}
                      </p>
                    )}
                    {rec.targetsLadderRoles.length > 0 && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Targets: {rec.targetsLadderRoles.join("; ")}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">
                      {rec.evidenceSources
                        .map((s) =>
                          s === "market"
                            ? "from jobs found"
                            : s === "ladder"
                              ? "ladder"
                              : s === "profile"
                                ? "profile"
                                : "industry knowledge"
                        )
                        .join(" · ")}
                      {typeof rec.marketSignalCount === "number" &&
                      rec.marketSignalCount > 0
                        ? ` · seen in ${rec.marketSignalCount} jobs`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-400">
                AI combines your ladder, industry knowledge, and requirements from
                matched jobs. Refreshes after Re-analyze and Find Jobs.
              </p>
            </div>
          ) : isProcessing ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Suggesting credentials…
            </p>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              Re-analyze or Find Jobs so AI can suggest certifications that unlock
              your next roles — using your ladder and what employers ask for.
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Career intent</CardTitle>
          {profile.careerIntent ? (
            <div className="mt-4 space-y-2 text-sm text-zinc-700">
              <p>
                <span className="font-medium">North star:</span>{" "}
                {profile.careerIntent.northStar}
              </p>
              <p className="text-zinc-600">{profile.careerIntent.narrative}</p>
              <p className="text-xs text-zinc-500">
                {profile.careerIntent.workSetting} · stretch{" "}
                {profile.careerIntent.stretchTolerance} · source{" "}
                {profile.careerIntent.source}
              </p>
              {profile.searchStrategy && (
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <p className="font-medium text-emerald-800">Dream</p>
                    <p className="text-zinc-600">
                      {profile.searchStrategy.dream.join(", ") || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-sky-800">Bridge</p>
                    <p className="text-zinc-600">
                      {profile.searchStrategy.bridge.join(", ") || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-rose-800">Never</p>
                    <p className="text-zinc-600">
                      {profile.searchStrategy.never.join(", ") || "—"}
                    </p>
                  </div>
                </div>
              )}
              <Link
                href="/intake"
                className="inline-block text-xs font-medium text-zinc-900 underline"
              >
                Continue conversation
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No intent yet.{" "}
              <Link href="/intake" className="underline">
                Start the career conversation
              </Link>
              .
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Inferred roles</CardTitle>
          {candidate?.inferredRoles?.length ? (
            <ul className="mt-4 space-y-2">
              {candidate.inferredRoles.map((r) => (
                <li key={r.role} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0 break-words">{r.role}</span>
                  <span className="shrink-0 text-zinc-500">{r.confidence}% confidence</span>
                </li>
              ))}
            </ul>
          ) : isProcessing ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> AI analyzing...
            </p>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No roles yet. Click Re-analyze to run AI extraction.
            </p>
          )}
          {profile && (
            <TargetRolesSection
              profile={profile}
              candidate={candidate}
              onSave={handleSaveProfile}
              apiFetch={apiFetch}
            />
          )}
        </Card>

        <Card>
          <CardTitle>Skills</CardTitle>
          <div className="mt-4 flex flex-wrap gap-2">
            {skills.length > 0 ? (
              skills.map((s) => (
                <span key={s} className="rounded-full bg-zinc-100 px-3 py-1 text-xs">{s}</span>
              ))
            ) : (
              <p className="text-sm text-zinc-500">
                {isProcessing ? "Extracting..." : "No skills extracted yet"}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Technologies</CardTitle>
          <div className="mt-4 flex flex-wrap gap-2">
            {technologies.length > 0 ? (
              technologies.map((t) => (
                <span key={t} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">{t}</span>
              ))
            ) : (
              <p className="text-sm text-zinc-500">
                {isProcessing ? "Extracting..." : "No technologies extracted yet"}
              </p>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Strengths & gaps</CardTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-medium text-emerald-700">Strengths</h4>
              {candidate?.strengths?.length ? (
                <ul className="mt-2 list-inside list-disc text-sm text-zinc-600">
                  {candidate.strengths.map((s) => <li key={s}>{s}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">
                  {isProcessing ? "Analyzing..." : "—"}
                </p>
              )}
            </div>
            <div>
              <h4 className="text-sm font-medium text-amber-700">Gaps</h4>
              {candidate?.gaps?.length ? (
                <ul className="mt-2 list-inside list-disc text-sm text-zinc-600">
                  {candidate.gaps.map((g) => <li key={g}>{g}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">
                  {isProcessing ? "Analyzing..." : "—"}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
