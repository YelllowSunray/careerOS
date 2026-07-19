import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import { matchJobToCandidate } from "@/agents/tools/job-match";
import { getJobMatch, saveJobMatch } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import { isWorkflowPaused } from "@/lib/workflows/pause";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Job, JobMatch } from "@/lib/types";

export interface JobMatchingInput {
  jobs: Job[];
  context: CandidateContext;
  fitScoreThreshold: number;
  workflowId?: string;
}

/** Re-score only jobs without a match; update applyRecommendation on existing matches. */
export const jobMatchingAgent: Agent<JobMatchingInput, JobMatch[]> = {
  name: "job-matching-agent",
  async execute(
    input: JobMatchingInput,
    ctx: AgentContext
  ): Promise<AgentResult<JobMatch[]>> {
    try {
      const matches: JobMatch[] = [];

      for (const job of input.jobs) {
        if (input.workflowId && (await isWorkflowPaused(input.workflowId))) {
          return { success: true, data: matches, paused: true };
        }

        const existing = await getJobMatch(`match_${job.id}`);

        if (existing) {
          existing.applyRecommendation =
            existing.fitScore >= input.fitScoreThreshold;
          await saveJobMatch(existing);
          matches.push(existing);
          continue;
        }

        const result = await matchJobToCandidate(job, input.context);
        if (result.languageRequirementMet === false) {
          console.log(
            `[Job matching] Skipped (language): ${job.title} @ ${job.company} · requires [${(result.requiredLanguages ?? []).join(", ") || "?"}]`
          );
          continue;
        }
        const match: JobMatch = {
          id: `match_${job.id}`,
          userId: ctx.userId,
          jobId: job.id,
          fitScore: result.fitScore,
          strengths: result.strengths,
          missingSkills: result.missingSkills,
          applyRecommendation: result.fitScore >= input.fitScoreThreshold,
          reasoning: result.reasoning,
          preferenceAlignment: result.preferenceAlignment,
          preferencesMatch: result.preferencesMatch,
          contributionScore: result.contributionScore,
          contributionNotes: result.contributionNotes,
          learningScore: result.learningScore,
          learningNotes: result.learningNotes,
          moneyScore: result.moneyScore,
          moneyNotes: result.moneyNotes,
          requiredLanguages: result.requiredLanguages,
          languageRequirementMet: result.languageRequirementMet,
          languageNotes: result.languageNotes,
          matchedAt: nowIso(),
        };
        await saveJobMatch(match);
        matches.push(match);
      }

      return { success: true, data: matches };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Job matching failed",
      };
    }
  },
};
