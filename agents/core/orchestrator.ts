import { createContext } from "@/agents/core/context";
import { resumeAgent } from "@/agents/resume/resume-agent";
import { portfolioAgent } from "@/agents/portfolio/portfolio-agent";
import { linkedInProfileAgent } from "@/agents/linkedin/linkedin-profile-agent";
import { candidateProfileAgent } from "@/agents/candidate-profile/candidate-profile-agent";
import { jobDiscoveryAgent } from "@/agents/job-discovery/job-discovery-agent";
import { generateApplicationMaterials } from "@/agents/tools/application-generate";
import { runBrowserAgent } from "@/agents/browser/browser-agent";
import { buildCandidateContext } from "@/lib/candidate/context";
import {
  coverLetterToPdfBuffer,
  isApplyDebugPreview,
} from "@/lib/applications/cover-letter-pdf";
import { normalizeUrl } from "@/lib/utils/url";
import {
  getProfile,
  getResume,
  getWorkflow,
  saveWorkflow,
  updateWorkflow,
  saveApplication,
  getApplication,
  getJob,
  getJobMatch,
  getLinkedInProfile,
} from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import { isWorkflowPaused, WorkflowPausedError } from "@/lib/workflows/pause";
import type { Workflow, WorkflowStep, JobMatch } from "@/lib/types";

function createWorkflow(
  userId: string,
  type: Workflow["type"],
  steps: string[],
  config: Record<string, unknown> = {}
): Workflow {
  return {
    id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    type,
    status: "running",
    steps: steps.map((name) => ({ name, status: "pending" as const })),
    config,
    startedAt: nowIso(),
  };
}

async function updateStep(
  workflow: Workflow,
  stepName: string,
  status: WorkflowStep["status"],
  error?: string
) {
  workflow.steps = workflow.steps.map((s) =>
    s.name === stepName
      ? {
          ...s,
          status,
          ...(status === "running" ? { startedAt: nowIso() } : {}),
          ...(status === "completed" || status === "failed"
            ? { completedAt: nowIso() }
            : {}),
          ...(error ? { error } : {}),
        }
      : s
  );
  await updateWorkflow(workflow.id, { steps: workflow.steps });
}

export class WorkflowOrchestrator {
  /** Creates workflow doc and returns immediately for async processing. */
  async startProfileProcessing(userId: string): Promise<Workflow> {
    const workflow = createWorkflow(userId, "process_profile", [
      "resume_processing",
      "portfolio_crawling",
      "linkedin_profile",
      "candidate_profile",
    ]);
    await saveWorkflow(workflow);
    return workflow;
  }

  /** Runs the full pipeline — resume, portfolio, LinkedIn, then synthesis. */
  async runProfileProcessing(userId: string, workflowId: string): Promise<void> {
    const profile = await getProfile(userId);
    if (!profile) throw new Error("Profile not found");

    const wf = await getWorkflow(workflowId);
    if (!wf) throw new Error("Workflow not found");

    const ctx = createContext(userId);
    let resumeRawSaved = false;

    try {
      if (profile.resume?.storagePath) {
        await updateStep(wf, "resume_processing", "running");
        const result = await resumeAgent.execute(
          {
            storagePath: profile.resume.storagePath,
            fileName: profile.resume.fileName,
          },
          ctx
        );
        resumeRawSaved = result.success && (result.data?.rawTextSaved ?? false);
        await updateStep(
          wf,
          "resume_processing",
          result.success ? "completed" : "failed",
          result.error
        );
      } else {
        await updateStep(wf, "resume_processing", "completed");
      }

      await updateStep(wf, "portfolio_crawling", "running");
      const portfolioUrls = profile.portfolioUrls.map(normalizeUrl).filter(Boolean);
      for (const url of portfolioUrls) {
        const siteId = `site_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await portfolioAgent.execute({ url, siteId }, ctx);
      }
      await updateStep(wf, "portfolio_crawling", "completed");

      await updateStep(wf, "linkedin_profile", "running");
      if (profile.linkedInUrl?.trim()) {
        const li = await linkedInProfileAgent.execute(undefined, ctx);
        await updateStep(
          wf,
          "linkedin_profile",
          li.success ? "completed" : "failed",
          li.error
        );
      } else {
        await updateStep(wf, "linkedin_profile", "completed");
      }

      const resume = await getResume(userId);
      const linkedIn = await getLinkedInProfile(userId);
      const hasResumeText = (resume?.rawText?.trim().length ?? 0) > 0;
      const hasPortfolio = portfolioUrls.length > 0;
      const hasLinkedIn = (linkedIn?.rawText?.trim().length ?? 0) > 0;

      if (!hasResumeText && !hasPortfolio && !hasLinkedIn) {
        throw new Error(
          "No resume, portfolio, or LinkedIn profile content available"
        );
      }
      if (
        !resumeRawSaved &&
        profile.resume?.storagePath &&
        !hasPortfolio &&
        !hasLinkedIn
      ) {
        throw new Error("Resume text extraction failed");
      }

      await updateStep(wf, "candidate_profile", "running");
      const profileResult = await candidateProfileAgent.execute(undefined, ctx);
      await updateStep(
        wf,
        "candidate_profile",
        profileResult.success ? "completed" : "failed",
        profileResult.error
      );

      const optionalWarning = profileResult.success
        ? undefined
        : `Optional profile summary failed: ${profileResult.error ?? "unknown"}`;

      wf.status = "completed";
      wf.completedAt = nowIso();
      wf.error = optionalWarning;
      await updateWorkflow(workflowId, {
        status: wf.status,
        completedAt: wf.completedAt,
        error: optionalWarning,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Profile processing failed";
      console.error(`[Orchestrator] Profile processing failed (${workflowId}):`, error);
      wf.status = "failed";
      wf.error = error;
      wf.completedAt = nowIso();
      await updateWorkflow(workflowId, {
        status: wf.status,
        error: wf.error,
        completedAt: wf.completedAt,
      });
    }
  }

  async processProfile(userId: string): Promise<Workflow> {
    const workflow = await this.startProfileProcessing(userId);
    await this.runProfileProcessing(userId, workflow.id);
    return (await getWorkflow(workflow.id)) ?? workflow;
  }

  async startFindJobs(
    userId: string,
    fitScoreThreshold = 85
  ): Promise<Workflow> {
    const workflow = createWorkflow(
      userId,
      "find_jobs",
      ["job_discovery"],
      { fitScoreThreshold, evaluatedListingKeys: [], round: 0 }
    );
    workflow.lastActivityAt = workflow.startedAt;
    await saveWorkflow(workflow);
    return workflow;
  }

  /** Heartbeat so continuous search is not marked stale while still working. */
  private async touchFindJobs(
    workflow: Workflow,
    patch: Partial<Workflow> = {}
  ): Promise<void> {
    const lastActivityAt = nowIso();
    workflow.lastActivityAt = lastActivityAt;
    await updateWorkflow(workflow.id, { lastActivityAt, ...patch });
  }

  /** Sleep between rounds; returns true if paused during the wait. */
  private async waitBetweenSearchRounds(
    workflowId: string,
    ms: number
  ): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await isWorkflowPaused(workflowId)) return true;
      await new Promise((r) => setTimeout(r, Math.min(2000, deadline - Date.now())));
    }
    return isWorkflowPaused(workflowId);
  }

  async runFindJobs(
    userId: string,
    workflowId: string,
    fitScoreThreshold = 85
  ): Promise<Workflow> {
    const workflow = await getWorkflow(workflowId);
    if (!workflow) throw new Error("Workflow not found");

    const ctx = createContext(userId);
    const ROUND_DELAY_MS = 20_000;
    const EMPTY_ROUND_DELAY_MS = 45_000;

    try {
      const context = await buildCandidateContext(userId);
      if (!context.hasRawSources) {
        throw new Error("Resume or portfolio content required for job discovery");
      }

      if (!context.structuredProfile) {
        const gen = await candidateProfileAgent.execute(undefined, ctx);
        if (gen.data) {
          context.structuredProfile = gen.data;
        }
      }

      if (await isWorkflowPaused(workflowId)) {
        throw new WorkflowPausedError();
      }

      await updateStep(workflow, "job_discovery", "running");
      await this.touchFindJobs(workflow);

      let round = 0;
      let evaluatedListingKeys = Array.isArray(workflow.config.evaluatedListingKeys)
        ? [...(workflow.config.evaluatedListingKeys as string[])]
        : [];

      // Continuous search: keep discovering until the user pauses.
      while (!(await isWorkflowPaused(workflowId))) {
        round++;
        console.log(`[Find jobs] Starting search round ${round}`);

        const discovery = await jobDiscoveryAgent.execute(
          {
            context,
            workflowId,
            minFitScore: fitScoreThreshold,
            round,
            skipIdentityKeys: evaluatedListingKeys,
          },
          ctx
        );

        if (discovery.paused || (await isWorkflowPaused(workflowId))) {
          throw new WorkflowPausedError();
        }

        if (!discovery.success) {
          throw new Error(discovery.error ?? "Job discovery failed");
        }

        const newKeys = Array.isArray(discovery.metadata?.evaluatedListingKeys)
          ? (discovery.metadata.evaluatedListingKeys as string[])
          : [];
        for (const key of newKeys) {
          if (!evaluatedListingKeys.includes(key)) {
            evaluatedListingKeys.push(key);
          }
        }

        const discovered = discovery.data?.length ?? 0;
        workflow.config = {
          ...workflow.config,
          fitScoreThreshold,
          round,
          evaluatedListingKeys,
          lastRoundDiscovered: discovered,
        };

        await this.touchFindJobs(workflow, {
          config: workflow.config,
          steps: workflow.steps,
        });

        console.log(
          `[Find jobs] Round ${round} done — ${discovered} new jobs (tracking ${evaluatedListingKeys.length} evaluated listings)`
        );

        if (await isWorkflowPaused(workflowId)) {
          throw new WorkflowPausedError();
        }

        const delay = discovered > 0 ? ROUND_DELAY_MS : EMPTY_ROUND_DELAY_MS;
        if (await this.waitBetweenSearchRounds(workflowId, delay)) {
          throw new WorkflowPausedError();
        }
      }

      throw new WorkflowPausedError();
    } catch (e) {
      if (e instanceof WorkflowPausedError || (await isWorkflowPaused(workflowId))) {
        return (await getWorkflow(workflowId)) ?? workflow;
      }

      workflow.status = "failed";
      workflow.error = e instanceof Error ? e.message : "Find jobs failed";
      workflow.completedAt = nowIso();
      await updateWorkflow(workflow.id, {
        status: workflow.status,
        error: workflow.error,
        completedAt: workflow.completedAt,
      });
    }

    return (await getWorkflow(workflowId)) ?? workflow;
  }

  async findJobs(
    userId: string,
    fitScoreThreshold = 85
  ): Promise<Workflow> {
    const workflow = await this.startFindJobs(userId, fitScoreThreshold);
    return this.runFindJobs(userId, workflow.id, fitScoreThreshold);
  }

  /** User-triggered: tailored materials + AI browser apply for a single job. */
  async runApplyToJob(userId: string, jobId: string): Promise<void> {
    const appId = `app_${jobId}`;

    const inFlight = await getApplication(appId);
    if (inFlight?.status === "applying") {
      console.log(`[Apply] Skipping ${jobId} — apply already in progress`);
      return;
    }

    try {
      const job = await getJob(jobId);
      if (!job || job.userId !== userId) {
        throw new Error("Job not found");
      }

      const profile = await getProfile(userId);
      if (!profile) throw new Error("Profile not found");
      if (!profile.resume?.storagePath) {
        throw new Error(
          "Upload a resume (PDF or Word) on your profile before applying"
        );
      }

      await saveApplication({
        id: appId,
        userId,
        jobId,
        jobTitle: job.title,
        company: job.company,
        status: "applying",
        fitScore: 0,
        materials: { coverLetter: "", resumeSummary: "", customAnswers: [] },
        applicationUrl: job.applicationUrl,
        jobDescription: job.description.slice(0, 8000),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });

      const context = await buildCandidateContext(userId);
      const match =
        (await getJobMatch(`match_${jobId}`)) ??
        ({
          id: `match_${jobId}`,
          userId,
          jobId,
          fitScore: 0,
          strengths: [],
          missingSkills: [],
          applyRecommendation: false,
          reasoning: "No saved match — applying with resume and profile only",
          matchedAt: nowIso(),
        } satisfies JobMatch);

      const now = nowIso();

      console.log(
        `[Apply] Generating tailored materials for ${job.title} @ ${job.company}`
      );
      const materials = await generateApplicationMaterials(job, context, match);

      if (materials.coverLetter.trim()) {
        console.log(
          `[Apply] Generated cover letter for ${job.title} @ ${job.company}:`
        );
        console.log("—".repeat(72));
        console.log(materials.coverLetter.trim());
        console.log("—".repeat(72));
      }

      const debugPreview = isApplyDebugPreview();
      const coverLetterPdf = materials.coverLetter.trim()
        ? await coverLetterToPdfBuffer(materials.coverLetter, {
            candidateName: profile.name,
            jobTitle: job.title,
            company: job.company,
          })
        : undefined;

      if (debugPreview) {
        console.log(
          `[Apply Preview] DEBUG mode — opening visible browser, filling form, NOT submitting`
        );
      }

      await saveApplication({
        id: appId,
        userId,
        jobId,
        jobTitle: job.title,
        company: job.company,
        status: "applying",
        fitScore: match.fitScore,
        materials,
        applicationUrl: job.applicationUrl,
        jobDescription: job.description.slice(0, 8000),
        createdAt: now,
        updatedAt: nowIso(),
      });

      console.log(`[Apply] Starting AI browser agent for ${job.applicationUrl}`);
      const session = await runBrowserAgent({
        applicationId: appId,
        applicationUrl: job.applicationUrl,
        profile,
        userId,
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        materials,
        debugPreview,
        coverLetterPdf,
        sourcePlatform: job.sourcePlatform,
      });

      const application = await getApplication(appId);
      if (!application) return;

      if (session.status === "preview") {
        application.status = "ready";
        application.error =
          "Debug preview — form filled in browser, not submitted. See server logs for cover letter.";
        application.browserSessionId = session.id;
      } else if (session.status === "completed") {
        application.status = "applied";
        application.appliedAt = nowIso();
        application.browserSessionId = session.id;
        application.error = undefined;
      } else {
        application.status = "ready";
        application.error =
          session.error ?? "Application incomplete — review and try again";
        application.browserSessionId = session.id;
      }
      application.updatedAt = nowIso();
      await saveApplication(application);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Apply failed";
      console.error(`[Apply] Failed for ${jobId}:`, e);
      const existing = await getApplication(appId);
      if (existing) {
        existing.status = "ready";
        existing.error = message;
        existing.updatedAt = nowIso();
        await saveApplication(existing);
      }
      throw e;
    }
  }

  async applyToJobs(userId: string, applicationIds: string[]): Promise<Workflow> {
    const workflow = createWorkflow(
      userId,
      "apply_jobs",
      applicationIds.map((id) => `apply_${id}`),
      { applicationIds }
    );
    await saveWorkflow(workflow);
    const profile = await getProfile(userId);
    if (!profile) throw new Error("Profile not found");

    try {
      for (const appId of applicationIds) {
        const stepName = `apply_${appId}`;
        await updateStep(workflow, stepName, "running");
        const application = await getApplication(appId);
        if (!application || !["ready", "applying"].includes(application.status)) {
          await updateStep(workflow, stepName, "failed", "Application not ready");
          continue;
        }

        application.status = "applying";
        application.updatedAt = nowIso();
        await saveApplication(application);

        const session = await runBrowserAgent({
          applicationId: appId,
          applicationUrl: application.applicationUrl,
          profile,
          userId,
          jobTitle: application.jobTitle,
          company: application.company,
          jobDescription: application.jobDescription,
          materials: application.materials,
        });

        if (session.status === "completed") {
          application.status = "applied";
          application.appliedAt = nowIso();
          application.browserSessionId = session.id;
        } else {
          application.error = session.error ?? "Application incomplete";
        }
        application.updatedAt = nowIso();
        await saveApplication(application);
        await updateStep(
          workflow,
          stepName,
          session.status === "completed" ? "completed" : "failed",
          session.error
        );
      }

      workflow.status = "completed";
      workflow.completedAt = nowIso();
      await updateWorkflow(workflow.id, {
        status: workflow.status,
        completedAt: workflow.completedAt,
      });
    } catch (e) {
      workflow.status = "failed";
      workflow.error = e instanceof Error ? e.message : "Apply workflow failed";
      workflow.completedAt = nowIso();
      await updateWorkflow(workflow.id, {
        status: workflow.status,
        error: workflow.error,
        completedAt: workflow.completedAt,
      });
    }

    return workflow;
  }
}

export const orchestrator = new WorkflowOrchestrator();
