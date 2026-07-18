import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import { generateApplicationMaterials } from "@/agents/tools/application-generate";
import { saveApplication } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import { isWorkflowPaused } from "@/lib/workflows/pause";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Application, Job, JobMatch } from "@/lib/types";

export interface ApplicationGenInput {
  jobs: Job[];
  matches: JobMatch[];
  context: CandidateContext;
  workflowId?: string;
}

export const applicationGenerationAgent: Agent<
  ApplicationGenInput,
  Application[]
> = {
  name: "application-generation-agent",
  async execute(
    input: ApplicationGenInput,
    ctx: AgentContext
  ): Promise<AgentResult<Application[]>> {
    try {
      const applications: Application[] = [];
      const recommended = input.matches.filter((m) => m.applyRecommendation);

      for (const match of recommended) {
        if (input.workflowId && (await isWorkflowPaused(input.workflowId))) {
          return { success: true, data: applications, paused: true };
        }

        const job = input.jobs.find((j) => j.id === match.jobId);
        if (!job) continue;

        const materials = await generateApplicationMaterials(
          job,
          input.context,
          match
        );

        const app: Application = {
          id: `app_${job.id}`,
          userId: ctx.userId,
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          status: "ready",
          fitScore: match.fitScore,
          materials,
          applicationUrl: job.applicationUrl,
          jobDescription: job.description.slice(0, 8000),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await saveApplication(app);
        applications.push(app);
      }

      return { success: true, data: applications };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Application generation failed",
      };
    }
  },
};
