"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ProfileDetailsCard } from "@/components/profile/profile-details-card";
import type { UserProfile, CandidateProfile, ResumeData, Workflow } from "@/lib/types";
import type { AiUsageRecord } from "@/lib/types/ai-usage";
import {
  AI_USAGE_CATEGORY_LABELS,
  getCategoryTotals,
  type AiUsageCategory,
} from "@/lib/ai-usage/categories";
import { isWorkflowActive, logWorkflowToConsole } from "@/lib/workflows/stale";
import { FileText, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
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
  const [uploadingCoverLetter, setUploadingCoverLetter] = useState(false);
  const [deletingCoverLetterId, setDeletingCoverLetterId] = useState<string | null>(null);

  const logError = (label: string, e: unknown) => {
    console.error(`[Profile] ${label}:`, e);
  };

  const loadData = useCallback(async () => {
    setProfileLoadError(null);
    const [p, c, r, w, u] = await Promise.all([
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
    ]);
    setProfile(p);
    setCandidate(c);
    setResume(r);
    setWorkflow(w);
    setAiUsage(u);

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

  if (loading) {
    return <div className="text-zinc-500">Loading profile...</div>;
  }

  if (profileLoadError) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-2xl font-semibold">Couldn’t load your profile</h1>
        <p className="mt-2 text-sm text-zinc-500">{profileLoadError}</p>
        <p className="mt-3 text-sm text-zinc-500">
          On Vercel, set <code className="rounded bg-zinc-100 px-1">FIREBASE_SERVICE_ACCOUNT_JSON</code>{" "}
          (the full service-account JSON). Localhost uses a file path that isn’t available in production.
        </p>
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
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-zinc-500">Your AI-built candidate knowledge graph</p>
        </div>
        <Button
          variant="secondary"
          onClick={handleReprocess}
          disabled={reprocessing || isProcessing}
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
          {profile.resume ? (
            <div className="mt-4 flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-zinc-400" />
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
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No resume uploaded</p>
          )}
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
                    className="flex items-start justify-between gap-3 rounded-lg border border-zinc-100 px-3 py-2"
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

        <Card>
          <CardTitle>Inferred roles</CardTitle>
          {candidate?.inferredRoles?.length ? (
            <ul className="mt-4 space-y-2">
              {candidate.inferredRoles.map((r) => (
                <li key={r.role} className="flex items-center justify-between text-sm">
                  <span>{r.role}</span>
                  <span className="text-zinc-500">{r.confidence}% confidence</span>
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
