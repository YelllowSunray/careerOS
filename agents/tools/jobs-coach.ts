import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { formatContextForPrompt } from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { CareerIntent, SearchStrategy } from "@/lib/types";
import { nowIso } from "@/lib/utils/dates";

const coachSchema = z.object({
  diagnosis: z.string(),
  clarifyingQuestion: z.string(),
  proposedStrategy: z.object({
    dream: z.array(z.string()),
    bridge: z.array(z.string()),
    never: z.array(z.string()),
  }),
  intentPatch: z
    .object({
      northStar: z.string().optional(),
      narrative: z.string().optional(),
      antiGoals: z.array(z.string()).optional(),
      workSetting: z.enum(["office", "hybrid", "floor", "flexible"]).optional(),
      openQuestions: z.array(z.string()).optional(),
    })
    .optional(),
});

export interface JobsCoachResult {
  diagnosis: string;
  clarifyingQuestion: string;
  proposedStrategy: SearchStrategy;
  intentPatch?: Partial<CareerIntent>;
}

export async function runJobsCoach(input: {
  context: CandidateContext;
  roundsWithoutSave?: number;
  recentRejectionThemes?: string[];
}): Promise<JobsCoachResult> {
  const result = await generateStructured(
    `You are Career OS jobs coach. The candidate's search is empty or stuck.

Diagnose why (craft gap vs wrong queries vs never-list conflict) and propose an updated Dream / Bridge / Never strategy they can confirm.

Rules:
- Honor anti-goals and office preference — never re-propose hands-on warehouse/floor titles they rejected.
- Bridge = hireable-now office-adjacent roles that still move toward the dream.
- Dream can stay aspirational.
- One clarifying question.
- Be concise and concrete.

Recent empty rounds: ${input.roundsWithoutSave ?? "unknown"}
Rejection themes: ${(input.recentRejectionThemes ?? []).join("; ") || "none logged"}

Return JSON:
{
  "diagnosis": "...",
  "clarifyingQuestion": "...",
  "proposedStrategy": { "dream": [], "bridge": [], "never": [] },
  "intentPatch": { "openQuestions": [] }
}

CANDIDATE:
${formatContextForPrompt(input.context, 12000)}`,
    coachSchema,
    {
      userId: input.context.userId,
      operation: "jobs_coach",
      coerce: (raw) => {
        if (!raw || typeof raw !== "object") return raw;
        const o = raw as Record<string, unknown>;
        return {
          diagnosis: String(o.diagnosis ?? o.summary ?? ""),
          clarifyingQuestion: String(
            o.clarifyingQuestion ?? o.clarifying_question ?? o.question ?? ""
          ),
          proposedStrategy: o.proposedStrategy ?? o.proposed_strategy ?? o.strategy,
          intentPatch: o.intentPatch ?? o.intent_patch,
        };
      },
    }
  );

  return {
    diagnosis: result.diagnosis.trim(),
    clarifyingQuestion: result.clarifyingQuestion.trim(),
    proposedStrategy: {
      dream: result.proposedStrategy.dream ?? [],
      bridge: result.proposedStrategy.bridge ?? [],
      never: result.proposedStrategy.never ?? [],
      confirmedAt: nowIso(),
    },
    intentPatch: result.intentPatch
      ? {
          northStar: result.intentPatch.northStar,
          narrative: result.intentPatch.narrative,
          antiGoals: result.intentPatch.antiGoals,
          workSetting: result.intentPatch.workSetting,
          openQuestions: result.intentPatch.openQuestions,
        }
      : undefined,
  };
}
