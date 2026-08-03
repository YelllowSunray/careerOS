import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { formatContextForPrompt } from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { CareerIntent, SearchStrategy } from "@/lib/types";
import { nowIso } from "@/lib/utils/dates";
import { ETHOS_AGENT_BLOCK } from "@/lib/career/ethos";
import { formatCareerIntentForPrompt } from "@/lib/job-search/career-intent";

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
      stretchTolerance: z
        .enum(["hireable_only", "show_stretch", "dream_aggressive"])
        .optional(),
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
  const northStar =
    input.context.profile.careerIntent?.northStar?.trim() || "their north star";
  const intentBlock = formatCareerIntentForPrompt(input.context.profile);

  const result = await generateStructured(
    `You are Career OS jobs coach. The candidate's path toward their north star is empty or stuck.

${ETHOS_AGENT_BLOCK}

NORTH STAR: "${northStar}"
${intentBlock || ""}

Diagnose why (unsearchable dream queries, craft gap, geo, senior conflict, never-list, hireable_only + only Head-of searches) and propose an updated Dream / Bridge / Never strategy they can confirm.

Rules:
- Speak in path language tied to the north star (footholds / steps / stretch — not silence).
- Honor Boundaries (Never / anti-goals) — never re-propose cliffs they named (warehouse floor, PA track, etc.).
- Bridge = board-ready 2–5 word hireable footholds that still move toward the star.
- Dream = at most careful stretch titles boards understand — never "founder of my own…".
- If stretchTolerance is hireable_only but they only search Head-of / founder titles, propose show_stretch + mid footholds OR keep hireable_only with real bridge queries.
- One clarifying question.
- Be concise, concrete, honest about tradeoffs.

Recent empty rounds: ${input.roundsWithoutSave ?? "unknown"}
Rejection themes: ${(input.recentRejectionThemes ?? []).join("; ") || "none logged"}

Return JSON:
{
  "diagnosis": "...",
  "clarifyingQuestion": "...",
  "proposedStrategy": { "dream": [], "bridge": [], "never": [] },
  "intentPatch": { "openQuestions": [], "stretchTolerance": "show_stretch" }
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
          stretchTolerance: result.intentPatch.stretchTolerance,
        }
      : undefined,
  };
}
