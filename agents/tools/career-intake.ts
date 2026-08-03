import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import {
  formatContextForPrompt,
  formatCareerLadderForPrompt,
} from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { CareerIntent, SearchStrategy } from "@/lib/types";
import { defaultStrategyFromIntent } from "@/lib/job-search/strategy";
import { nowIso } from "@/lib/utils/dates";
import { ETHOS_AGENT_BLOCK } from "@/lib/career/ethos";

const chatSchema = z.object({
  assistantMessage: z.string(),
  isComplete: z.boolean(),
  clarifyingQuestion: z.string().optional(),
  draftIntent: z
    .object({
      northStar: z.string().optional(),
      narrative: z.string().optional(),
      antiGoals: z.array(z.string()).optional(),
      workSetting: z.enum(["office", "hybrid", "floor", "flexible"]).optional(),
      horizonNow: z.array(z.string()).optional(),
      horizonSixMonths: z.array(z.string()).optional(),
      horizonTwoYears: z.array(z.string()).optional(),
      stretchTolerance: z
        .enum(["hireable_only", "show_stretch", "dream_aggressive"])
        .optional(),
      moneyFloor: z.string().optional(),
      nonNegotiables: z.array(z.string()).optional(),
      openQuestions: z.array(z.string()).optional(),
    })
    .optional(),
  draftStrategy: z
    .object({
      dream: z.array(z.string()).optional(),
      bridge: z.array(z.string()).optional(),
      never: z.array(z.string()).optional(),
    })
    .optional(),
});

export type IntakeChatMessage = { role: "user" | "assistant"; content: string };

export interface IntakeChatResult {
  assistantMessage: string;
  isComplete: boolean;
  clarifyingQuestion?: string;
  careerIntent?: CareerIntent;
  searchStrategy?: SearchStrategy;
}

function coerceIntake(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  return {
    assistantMessage: String(
      o.assistantMessage ?? o.assistant_message ?? o.message ?? ""
    ),
    isComplete: Boolean(o.isComplete ?? o.is_complete ?? o.complete),
    clarifyingQuestion: String(
      o.clarifyingQuestion ?? o.clarifying_question ?? ""
    ).trim() || undefined,
    draftIntent: o.draftIntent ?? o.draft_intent ?? o.intent,
    draftStrategy: o.draftStrategy ?? o.draft_strategy ?? o.strategy,
  };
}

export async function runIntakeChat(input: {
  context: CandidateContext;
  messages: IntakeChatMessage[];
  language?: "nl" | "en";
}): Promise<IntakeChatResult> {
  const turn = input.messages.filter((m) => m.role === "user").length;
  const history = input.messages
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const result = await generateStructured(
    `You are Career OS intake coach — guide them toward a clear north star and honest footholds.

${ETHOS_AGENT_BLOCK}

Get to know hopes, dreams, anti-goals, and stretch appetite after they filled basic profile/CV forms.

Agenda (cover across turns; you are on turn ${turn} of ~6):
1) Ideal next role / north star in their words
2) What they refuse forever (anti-goals / cliffs)
3) Work setting: office / hybrid / floor / flexible
4) Money floor if any
5) Stretch tolerance: hireable_only | show_stretch (default for ambition) | dream_aggressive
6) Near-term footholds vs 6–12 mo vs ~2 year horizon titles
7) When enough is known, set isComplete=true and fill draftIntent + draftStrategy

Rules:
- Be warm, concise (2–4 sentences + one question until complete).
- Prefer their language (${input.language === "en" ? "English" : "Dutch or match user"}).
- Never push them back onto a cliff they named (warehouse floor, PA track, etc.).
- draftStrategy.dream = aspiration titles boards understand; bridge = hireable footholds toward the star; never = cliffs.
- Default stretchTolerance to show_stretch when they have ambition beyond hireable-now.
- When isComplete=true, draftIntent and draftStrategy MUST be fully populated.

${formatCareerLadderForPrompt(input.context) || ""}

Return JSON:
{
  "assistantMessage": "...",
  "isComplete": false,
  "clarifyingQuestion": "...",
  "draftIntent": { "northStar": "", "narrative": "", "antiGoals": [], "workSetting": "office", "horizonNow": [], "horizonSixMonths": [], "horizonTwoYears": [], "stretchTolerance": "show_stretch", "nonNegotiables": [], "openQuestions": [] },
  "draftStrategy": { "dream": [], "bridge": [], "never": [] }
}

CONVERSATION:
${history || "(start — greet and ask first question)"}

CANDIDATE CONTEXT:
${formatContextForPrompt(input.context, 10000)}`,
    chatSchema,
    {
      userId: input.context.userId,
      operation: "career_intake",
      coerce: coerceIntake,
    }
  );

  let careerIntent: CareerIntent | undefined;
  let searchStrategy: SearchStrategy | undefined;

  if (result.draftIntent) {
    const d = result.draftIntent;
    careerIntent = {
      northStar: (d.northStar ?? "").trim(),
      narrative: (d.narrative ?? "").trim(),
      antiGoals: d.antiGoals ?? [],
      workSetting: d.workSetting ?? "flexible",
      horizon: {
        now: d.horizonNow ?? [],
        sixMonths: d.horizonSixMonths ?? [],
        twoYears: d.horizonTwoYears ?? [],
      },
      stretchTolerance: d.stretchTolerance ?? "show_stretch",
      moneyFloor: d.moneyFloor?.trim() || undefined,
      nonNegotiables: d.nonNegotiables ?? [],
      openQuestions: d.openQuestions ?? [],
      updatedAt: nowIso(),
      source: "intake",
    };
  }

  if (result.isComplete && careerIntent) {
    const draft = result.draftStrategy;
    searchStrategy = draft
      ? {
          dream: draft.dream ?? [],
          bridge: draft.bridge ?? [],
          never: draft.never ?? [],
          confirmedAt: nowIso(),
        }
      : defaultStrategyFromIntent(
          careerIntent,
          input.language === "en" ? "en" : "nl"
        );
  }

  return {
    assistantMessage: result.assistantMessage.trim(),
    isComplete: result.isComplete,
    clarifyingQuestion: result.clarifyingQuestion,
    careerIntent,
    searchStrategy,
  };
}
