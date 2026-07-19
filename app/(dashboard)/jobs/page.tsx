"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { Job, JobMatch, Workflow, Application, CoverLetterLanguage } from "@/lib/types";
import type { AiUsageRecord } from "@/lib/types/ai-usage";
import { getCategoryTotals } from "@/lib/ai-usage/categories";
import { isWorkflowActive, isWorkflowPaused } from "@/lib/workflows/stale";
import { StatusBadge } from "@/components/ui/badge";
import { Copy, FileText, Loader2, Pause, Sparkles, Trash2 } from "lucide-react";

function formatJobSource(job: Job): string {
  const labels: Record<string, string> = {
    linkedin: "LinkedIn",
    indeed: "Indeed",
    remotive: "Remotive",
    arbeitnow: "Arbeitnow",
    remoteok: "RemoteOK",
    adzuna: "Adzuna",
    playwright: "Playwright + AI",
    career_page: "Career page",
  };
  if (job.sourcePlatform && labels[job.sourcePlatform]) {
    return labels[job.sourcePlatform];
  }
  if (job.sourcePlatform) {
    return job.sourcePlatform.replace(/_/g, " ");
  }
  if (job.source === "career_page") return "Career page";
  return "Job board";
}

function activeStepLabel(workflow: Workflow | null): string {
  if (!workflow) return "Starting…";
  const round = Number(workflow.config?.round ?? 0);
  const lastNew = Number(workflow.config?.lastRoundDiscovered ?? 0);
  if (round > 0) {
    if (lastNew < 0) {
      return `Round ${round} — scanning boards (deeper pages)…`;
    }
    if (lastNew === 0) {
      return `Round ${round} found no new roles — paging deeper…`;
    }
    return `Round ${round} saved ${lastNew} new · continuing…`;
  }
  const running = workflow.steps.find((s) => s.status === "running");
  if (running) {
    return running.name.replace(/_/g, " ");
  }
  return "Searching…";
}

export default function JobsPage() {
  const { apiFetch } = useApi();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [matches, setMatches] = useState<JobMatch[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [finding, setFinding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [coverLetterJobId, setCoverLetterJobId] = useState<string | null>(null);
  const [coverLetterLang, setCoverLetterLang] = useState<CoverLetterLanguage | null>(null);
  const [expandedLetters, setExpandedLetters] = useState<Record<string, boolean>>({});
  const [expandedBriefs, setExpandedBriefs] = useState<Record<string, boolean>>({});
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageRecord | null>(null);
  const [matchSources, setMatchSources] = useState<{
    resume: boolean;
    portfolio: boolean;
    linkedin: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [j, m, a, u, w, c] = await Promise.all([
        apiFetch("/api/data?type=jobs"),
        apiFetch("/api/data?type=matches"),
        apiFetch("/api/data?type=applications").catch(() => []),
        apiFetch("/api/data?type=ai-usage").catch(() => null),
        apiFetch("/api/workflows/status?type=find_jobs").catch(() => null),
        apiFetch("/api/data?type=candidate").catch(() => null),
      ]);
      setJobs(j ?? []);
      setMatches(m ?? []);
      setApplications(a ?? []);
      setAiUsage(u);
      setWorkflow(w);
      setFinding(isWorkflowActive(w));
      if (c?.sources) {
        setMatchSources({
          resume: !!c.sources.resume,
          portfolio: !!c.sources.portfolio,
          linkedin: !!c.sources.linkedin,
        });
      }
    } catch {
      // Keep existing jobs/matches visible if a poll fails (e.g. during pause).
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!finding) return;
    const interval = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(interval);
  }, [finding, load]);

  useEffect(() => {
    const hasApplying = applications.some((a) => a.status === "applying");
    if (!hasApplying) return;
    const interval = setInterval(() => {
      load();
    }, 4000);
    return () => clearInterval(interval);
  }, [applications, load]);

  async function handleApply(jobId: string) {
    setApplyingJobId(jobId);
    try {
      await apiFetch("/api/jobs/apply", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to start application");
    } finally {
      setApplyingJobId(null);
    }
  }

  async function handleGenerateCoverLetter(
    jobId: string,
    language: CoverLetterLanguage
  ) {
    setCoverLetterJobId(jobId);
    setCoverLetterLang(language);
    try {
      const result = await apiFetch("/api/jobs/cover-letter", {
        method: "POST",
        body: JSON.stringify({ jobId, language }),
      });
      if (result?.application) {
        setApplications((prev) => {
          const others = prev.filter((a) => a.jobId !== jobId);
          return [...others, result.application as Application];
        });
        setExpandedLetters((prev) => ({ ...prev, [jobId]: true }));
      }
      // Refresh Gemini usage so cover letter credits appear immediately.
      const usage = await apiFetch("/api/data?type=ai-usage").catch(() => null);
      if (usage) setAiUsage(usage);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to generate cover letter");
    } finally {
      setCoverLetterJobId(null);
      setCoverLetterLang(null);
    }
  }

  async function copyCoverLetter(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      alert("Could not copy to clipboard");
    }
  }

  async function handleFindJobs() {
    if (finding) return;
    setFinding(true);

    try {
      const result = await apiFetch("/api/workflows/find-jobs", { method: "POST" });
      setWorkflow(result?.workflow ?? null);
      if (result?.status === "failed") {
        alert(result?.workflow?.error ?? result?.error ?? "Find jobs failed");
        setFinding(false);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to find jobs");
      setFinding(false);
    }
  }

  async function handlePause() {
    setPausing(true);
    try {
      await apiFetch("/api/workflows/pause", {
        method: "POST",
        body: JSON.stringify({ type: "find_jobs" }),
      });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to pause job search");
    } finally {
      setPausing(false);
    }
  }

  async function handleClearResults() {
    if (
      !confirm(
        "Delete all job search results (jobs, matches, and applications)? This cannot be undone."
      )
    ) {
      return;
    }

    setClearing(true);
    try {
      await apiFetch("/api/jobs/clear", { method: "DELETE" });
      setJobs([]);
      setMatches([]);
      setApplications([]);
      setWorkflow(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to clear results");
    } finally {
      setClearing(false);
    }
  }

  const isDev = process.env.NODE_ENV === "development";

  const matchMap = new Map(matches.map((m) => [m.jobId, m]));
  const appByJobId = new Map(applications.map((a) => [a.jobId, a]));

  const sortedJobs = [...jobs]
    .filter((job) => matchMap.get(job.id)?.languageRequirementMet !== false)
    .sort((a, b) => {
      const scoreA = matchMap.get(a.id)?.fitScore ?? -1;
      const scoreB = matchMap.get(b.id)?.fitScore ?? -1;
      return scoreB - scoreA;
    });

  const categoryTotals = aiUsage ? getCategoryTotals(aiUsage) : null;
  const jobSearchUsage = categoryTotals?.job_search ?? null;
  const coverLetterUsage = categoryTotals?.application ?? null;
  const showGeminiUsage =
    (jobSearchUsage?.requestCount ?? 0) > 0 ||
    (coverLetterUsage?.requestCount ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="text-zinc-500">
            AI searches LinkedIn/Indeed and scores each listing against your resume, LinkedIn profile, portfolio, languages, and job preferences.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDev && (
            <Button
              variant="danger"
              onClick={handleClearResults}
              disabled={finding || clearing || (jobs.length === 0 && matches.length === 0)}
            >
              {clearing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Clearing…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear results
                </>
              )}
            </Button>
          )}
          {finding ? (
            <Button variant="secondary" onClick={handlePause} disabled={pausing}>
              {pausing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Pausing…
                </>
              ) : (
                <>
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </>
              )}
            </Button>
          ) : (
            <Button onClick={handleFindJobs}>
              Find Jobs
            </Button>
          )}
        </div>
      </div>

      {finding && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">Searching continuously until you pause…</p>
            <p className="text-violet-600">
              {activeStepLabel(workflow)}
              {jobs.length > 0 && ` · ${jobs.length} matched so far`}
            </p>
          </div>
        </div>
      )}

      {workflow?.status === "failed" && !finding && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {workflow.error ?? "Job search stopped."} Click Find Jobs to start again.
        </div>
      )}

      {isWorkflowPaused(workflow) && !finding && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Job search was paused. Results found before pausing are shown below.
        </div>
      )}

      {matchSources && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          <p className="font-medium text-zinc-900">Match scoring uses</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                matchSources.resume
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-zinc-200 text-zinc-500"
              }`}
            >
              Resume {matchSources.resume ? "✓" : "—"}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                matchSources.linkedin
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-zinc-200 text-zinc-500"
              }`}
            >
              LinkedIn profile {matchSources.linkedin ? "✓" : "—"}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                matchSources.portfolio
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-zinc-200 text-zinc-500"
              }`}
            >
              Portfolio {matchSources.portfolio ? "✓" : "—"}
            </span>
          </div>
          {!matchSources.linkedin && (
            <p className="mt-2 text-xs text-zinc-500">
              Add your LinkedIn URL on Profile and click Re-analyze so job matches use your LinkedIn experience — not just the URL.
            </p>
          )}
        </div>
      )}

      {showGeminiUsage && (
        <Card className="border-violet-100 bg-violet-50/50">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 text-violet-500" />
            <div className="w-full space-y-3 text-sm">
              <p className="font-medium text-violet-900">Gemini usage</p>
              {jobSearchUsage && jobSearchUsage.requestCount > 0 && (
                <div>
                  <p className="font-medium text-violet-800">Job search</p>
                  <p className="mt-0.5 text-violet-800">
                    {jobSearchUsage.totalTokens.toLocaleString()} tokens ·{" "}
                    {jobSearchUsage.requestCount} API calls · est. $
                    {jobSearchUsage.estimatedCostUsd.toFixed(4)}
                  </p>
                  <p className="mt-0.5 text-xs text-violet-600">
                    Role queries, listing extraction, parsing, and matching.
                  </p>
                </div>
              )}
              {coverLetterUsage && coverLetterUsage.requestCount > 0 && (
                <div>
                  <p className="font-medium text-violet-800">Cover letters & applications</p>
                  <p className="mt-0.5 text-violet-800">
                    {coverLetterUsage.totalTokens.toLocaleString()} tokens ·{" "}
                    {coverLetterUsage.requestCount} API calls · est. $
                    {coverLetterUsage.estimatedCostUsd.toFixed(4)}
                  </p>
                  <p className="mt-0.5 text-xs text-violet-600">
                    Cover letter generation, listing re-parse for letters, and apply-time AI.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {loading && jobs.length === 0 ? (
        <p className="text-zinc-500">Loading jobs...</p>
      ) : jobs.length === 0 && !finding ? (
        <Card>
          <p className="text-zinc-500">
            No jobs yet. Click &quot;Find Jobs&quot; to discover roles that genuinely fit your background.
          </p>
        </Card>
      ) : jobs.length === 0 && finding ? (
        <Card>
          <p className="text-zinc-500">
            Scanning job boards — matches will appear here as they are found.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedJobs.map((job) => {
            const match = matchMap.get(job.id);
            const application = appByJobId.get(job.id);
            const isApplying =
              applyingJobId === job.id ||
              application?.status === "applying";
            const letter = application?.materials?.coverLetter?.trim() ?? "";
            const letterLang = application?.materials?.coverLetterLanguage;
            const sources = application?.materials?.coverLetterSources;
            const generating = coverLetterJobId === job.id;
            const showLetter = !!letter && (expandedLetters[job.id] ?? true);
            const showBrief = !!sources && (expandedBriefs[job.id] ?? false);
            const thinBrief = (sources?.listingTextChars ?? 0) > 0 && (sources?.listingTextChars ?? 0) < 800;

            return (
              <Card key={job.id} className={match && match.fitScore < 50 ? "opacity-60" : ""}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{job.title}</CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-zinc-500">
                        {job.company} · {job.location}
                      </p>
                      {job.applicationUrl ? (
                        <a
                          href={job.applicationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                        >
                          {formatJobSource(job)} →
                        </a>
                      ) : (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          {formatJobSource(job)}
                        </span>
                      )}
                      {job.discoveredVia?.length > 0 && (
                        <span className="text-xs text-zinc-400">
                          via &quot;{job.discoveredVia[0]}&quot;
                        </span>
                      )}
                    </div>
                  </div>
                  {match ? (
                    <div className="text-right">
                      <div className="text-2xl font-bold text-zinc-900">
                        {match.fitScore}
                      </div>
                      <div className="text-xs text-zinc-500">fit score</div>
                    </div>
                  ) : (
                    <div className="text-right text-xs text-zinc-400">Not scored</div>
                  )}
                </div>
                {match && (
                  <div className="mt-4 space-y-2 text-sm">
                    {match.preferenceAlignment && (
                      <div
                        className={`rounded-lg px-3 py-2 ${
                          match.preferencesMatch
                            ? "bg-emerald-50 text-emerald-900"
                            : "bg-sky-50 text-sky-900"
                        }`}
                      >
                        <p className="font-medium">
                          {match.preferencesMatch
                            ? "Aligned with stated preferences"
                            : "Outside stated preferences (kept for growth potential)"}
                        </p>
                        <p className="mt-0.5">{match.preferenceAlignment}</p>
                      </div>
                    )}
                    {(match.contributionScore != null ||
                      match.learningScore != null ||
                      match.moneyScore != null) && (
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            label: "Contribute",
                            score: match.contributionScore,
                            notes: match.contributionNotes,
                            tone: "bg-emerald-50 text-emerald-950",
                          },
                          {
                            label: "Learn",
                            score: match.learningScore,
                            notes: match.learningNotes,
                            tone: "bg-violet-50 text-violet-950",
                          },
                          {
                            label: "Money",
                            score: match.moneyScore,
                            notes: match.moneyNotes,
                            tone: "bg-amber-50 text-amber-950",
                          },
                        ].map((pillar) => (
                          <div
                            key={pillar.label}
                            className={`rounded-lg px-2.5 py-2 ${pillar.tone}`}
                            title={pillar.notes || undefined}
                          >
                            <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">
                              {pillar.label}
                            </p>
                            <p className="text-lg font-semibold tabular-nums">
                              {pillar.score != null ? pillar.score : "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {(match.contributionNotes ||
                      match.learningNotes ||
                      match.moneyNotes) && (
                      <div className="space-y-1.5 text-xs text-zinc-600">
                        {match.contributionNotes && (
                          <p>
                            <span className="font-medium text-emerald-800">
                              Contribute:{" "}
                            </span>
                            {match.contributionNotes}
                          </p>
                        )}
                        {match.learningNotes && (
                          <p>
                            <span className="font-medium text-violet-800">
                              Learn:{" "}
                            </span>
                            {match.learningNotes}
                          </p>
                        )}
                        {match.moneyNotes && (
                          <p>
                            <span className="font-medium text-amber-800">
                              Money:{" "}
                            </span>
                            {match.moneyNotes}
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-zinc-600">{match.reasoning}</p>
                    {match.strengths.length > 0 && (
                      <p>
                        <span className="font-medium text-emerald-700">Strengths: </span>
                        {match.strengths.join(", ")}
                      </p>
                    )}
                    {match.missingSkills.length > 0 && (
                      <p>
                        <span className="font-medium text-amber-700">Missing: </span>
                        {match.missingSkills
                          .map((s) => `${s.skill}${s.isHardRequirement ? " (required)" : ""}`)
                          .join(", ")}
                      </p>
                    )}
                    {match.applyRecommendation && (
                      <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Recommended to apply
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {application?.status === "applied" ? (
                    <StatusBadge status="applied" />
                  ) : isApplying ? (
                    <span className="inline-flex items-center gap-2 text-sm text-violet-700">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Applying with AI…
                    </span>
                  ) : (
                    <Button
                      onClick={() => handleApply(job.id)}
                      disabled={!!applyingJobId || generating}
                    >
                      Apply
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => handleGenerateCoverLetter(job.id, "en")}
                    disabled={generating || !!applyingJobId}
                  >
                    {generating && coverLetterLang === "en" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    Cover letter EN
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleGenerateCoverLetter(job.id, "nl")}
                    disabled={generating || !!applyingJobId}
                  >
                    {generating && coverLetterLang === "nl" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    Cover letter NL
                  </Button>
                  <a
                    href={job.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View posting →
                  </a>
                </div>

                {letter && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50/80">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
                        <button
                          type="button"
                          className="text-left text-sm font-medium text-zinc-800 hover:underline"
                          onClick={() =>
                            setExpandedLetters((prev) => ({
                              ...prev,
                              [job.id]: !showLetter,
                            }))
                          }
                        >
                          Cover letter
                          {letterLang === "nl"
                            ? " (NL)"
                            : letterLang === "en"
                              ? " (EN)"
                              : ""}
                          {showLetter ? " · hide" : " · show"}
                        </button>
                        <Button
                          variant="ghost"
                          className="h-8 px-2 text-zinc-600"
                          onClick={() => copyCoverLetter(letter)}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </div>
                      {showLetter && (
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-zinc-700">
                          {letter}
                        </pre>
                      )}
                    </div>

                    {sources && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/60">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-amber-950 hover:underline"
                          onClick={() =>
                            setExpandedBriefs((prev) => ({
                              ...prev,
                              [job.id]: !showBrief,
                            }))
                          }
                        >
                          <span>
                            Job brief used for this letter · {sources.listingTextChars.toLocaleString()} chars
                            {thinBrief ? " · thin — may miss requirements" : ""}
                          </span>
                          <span className="text-xs font-normal text-amber-800">
                            {showBrief ? "hide" : "inspect"}
                          </span>
                        </button>
                        {showBrief && (
                          <div className="space-y-3 border-t border-amber-200 px-3 py-3 text-sm text-amber-950">
                            <p className="text-xs text-amber-800">
                              This is the exact listing text Gemini received (from{" "}
                              <a
                                href={sources.listingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                the posting URL
                              </a>
                              ). If key requirements are missing here, they cannot appear in the letter.
                            </p>

                            {sources.requirementMatches.length > 0 && (
                              <div>
                                <p className="mb-1 font-medium">Requirement → evidence map</p>
                                <ul className="space-y-2">
                                  {sources.requirementMatches.map((rm, i) => (
                                    <li
                                      key={`${rm.requirement}-${i}`}
                                      className="rounded border border-amber-100 bg-white/70 px-2 py-1.5 text-xs"
                                    >
                                      <p>
                                        <span
                                          className={
                                            rm.matched
                                              ? "font-medium text-emerald-700"
                                              : "font-medium text-amber-700"
                                          }
                                        >
                                          {rm.matched ? "Matched" : "Not matched"}:
                                        </span>{" "}
                                        {rm.requirement}
                                      </p>
                                      <p className="mt-0.5 text-zinc-600">{rm.candidateEvidence}</p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div>
                              <p className="mb-1 font-medium">Structured requirements</p>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/70 px-2 py-2 text-xs text-zinc-700">
                                {sources.structuredRequirements || "(none)"}
                              </pre>
                            </div>

                            <div>
                              <p className="mb-1 font-medium">Full posting text sent to AI</p>
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white/70 px-2 py-2 text-xs text-zinc-700">
                                {sources.listingText || "(empty)"}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
