import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import {
  formatContextForPrompt,
  formatCareerLadderForPrompt,
} from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { CareerIntent, SearchStrategy } from "@/lib/types";
import { defaultStrategyFromIntent } from "@/lib/job-search/strategy";
import {
  coerceStretchTolerance,
  coerceWorkSetting,
} from "@/lib/job-search/career-intent";
import { nowIso } from "@/lib/utils/dates";
import { ETHOS_AGENT_BLOCK } from "@/lib/career/ethos";

const WORK_SETTINGS = ["office", "hybrid", "floor", "flexible"] as const;
const STRETCH = [
  "hireable_only",
  "show_stretch",
  "dream_aggressive",
] as const;

const chatSchema = z.object({
  assistantMessage: z.string(),
  isComplete: z.boolean(),
  clarifyingQuestion: z.string().optional(),
  draftIntent: z
    .object({
      northStar: z.string().optional(),
      narrative: z.string().optional(),
      antiGoals: z.array(z.string()).optional(),
      workSetting: z.enum(WORK_SETTINGS).optional(),
      horizonNow: z.array(z.string()).optional(),
      horizonSixMonths: z.array(z.string()).optional(),
      horizonTwoYears: z.array(z.string()).optional(),
      stretchTolerance: z.enum(STRETCH).optional(),
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

function asStringList(raw: unknown, max = 12): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    return t
      .split(/[,;\n|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, max);
  }
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((x) => {
          if (typeof x === "string") return x.trim();
          if (x && typeof x === "object") {
            const o = x as Record<string, unknown>;
            return String(o.title ?? o.name ?? o.label ?? o.text ?? "").trim();
          }
          return String(x ?? "").trim();
        })
        .filter((s) => s.length > 0)
    ),
  ].slice(0, max);
}

function asOptionalString(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  const s = String(raw).trim();
  return s.length > 0 ? s : undefined;
}

function asBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  return s === "true" || s === "yes" || s === "1" || s === "complete";
}

function coerceDraftIntent(raw: unknown): unknown {
  if (raw == null) return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;

  const horizon =
    o.horizon && typeof o.horizon === "object"
      ? (o.horizon as Record<string, unknown>)
      : {};

  const workSetting = coerceWorkSetting(
    o.workSetting ?? o.work_setting ?? o.setting ?? o.workEnvironment
  );
  const stretchTolerance = coerceStretchTolerance(
    o.stretchTolerance ?? o.stretch_tolerance ?? o.stretch ?? o.ambition
  );

  const draft: Record<string, unknown> = {
    northStar: asOptionalString(
      o.northStar ?? o.north_star ?? o.idealRole ?? o.dream
    ),
    narrative: asOptionalString(o.narrative ?? o.story ?? o.summary),
    antiGoals: asStringList(o.antiGoals ?? o.anti_goals ?? o.neverWant),
    horizonNow: asStringList(
      o.horizonNow ?? o.horizon_now ?? horizon.now ?? o.nearTerm
    ),
    horizonSixMonths: asStringList(
      o.horizonSixMonths ??
        o.horizon_six_months ??
        horizon.sixMonths ??
        horizon.six_months
    ),
    horizonTwoYears: asStringList(
      o.horizonTwoYears ??
        o.horizon_two_years ??
        horizon.twoYears ??
        horizon.two_years
    ),
    moneyFloor: asOptionalString(
      o.moneyFloor ?? o.money_floor ?? o.salaryFloor ?? o.minSalary
    ),
    nonNegotiables: asStringList(
      o.nonNegotiables ?? o.non_negotiables ?? o.mustHaves
    ),
    openQuestions: asStringList(
      o.openQuestions ?? o.open_questions ?? o.questions
    ),
  };

  if (workSetting) draft.workSetting = workSetting;
  if (stretchTolerance) draft.stretchTolerance = stretchTolerance;

  // Drop empty optional arrays / undefineds — keep object always valid for Zod
  for (const key of Object.keys(draft)) {
    const v = draft[key];
    if (v === undefined) delete draft[key];
    if (Array.isArray(v) && v.length === 0) {
      // keep empty arrays — they're valid and useful as "known empty"
    }
  }

  return draft;
}

function coerceDraftStrategy(raw: unknown): unknown {
  if (raw == null) return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    dream: asStringList(o.dream ?? o.dreams ?? o.aspirations, 8),
    bridge: asStringList(o.bridge ?? o.bridges ?? o.footholds ?? o.next, 10),
    never: asStringList(o.never ?? o.cliffs ?? o.antiGoals, 12),
  };
}

/** Normalize Gemini JSON before Zod — never let enum typos kill the chat turn. */
export function coerceIntake(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return {
      assistantMessage: "",
      isComplete: false,
    };
  }
  const o = raw as Record<string, unknown>;

  let draftIntent: unknown;
  try {
    draftIntent = coerceDraftIntent(
      o.draftIntent ?? o.draft_intent ?? o.intent ?? o.careerIntent
    );
  } catch {
    draftIntent = undefined;
  }

  let draftStrategy: unknown;
  try {
    draftStrategy = coerceDraftStrategy(
      o.draftStrategy ?? o.draft_strategy ?? o.strategy ?? o.searchStrategy
    );
  } catch {
    draftStrategy = undefined;
  }

  return {
    assistantMessage: String(
      o.assistantMessage ?? o.assistant_message ?? o.message ?? ""
    ),
    isComplete: asBoolean(o.isComplete ?? o.is_complete ?? o.complete),
    clarifyingQuestion:
      asOptionalString(
        o.clarifyingQuestion ?? o.clarifying_question ?? o.question
      ) || undefined,
    ...(draftIntent ? { draftIntent } : {}),
    ...(draftStrategy ? { draftStrategy } : {}),
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

  let result: z.infer<typeof chatSchema>;
  try {
    result = await generateStructured(
      `You are Career OS intake coach — guide them toward a clear north star and honest footholds.

${ETHOS_AGENT_BLOCK}

Get to know hopes, dreams, anti-goals, and stretch appetite after they filled basic profile/CV forms.

Agenda (cover across turns; you are on turn ${turn} of ~6):
1) Ideal next role / north star in their words
2) What they refuse forever (anti-goals / cliffs)
3) Work setting — MUST use exactly one of: office | hybrid | floor | flexible
   Map synonyms: thuis/home/remote/WFH → flexible; kantoor/on-site → office; hybride → hybrid; werkvloer/magazijn → floor
4) Money floor if any (string is fine, e.g. "€3000 netto")
5) Stretch tolerance — MUST use exactly one of: hireable_only | show_stretch | dream_aggressive
6) Near-term footholds vs 6–12 mo vs ~2 year horizon titles
7) When enough is known, set isComplete=true and fill draftIntent + draftStrategy

Rules:
- Be warm, concise (2–4 sentences + one question until complete).
- Prefer their language (${input.language === "en" ? "English" : "Dutch or match user"}).
- Never push them back onto a cliff they named (warehouse floor, PA track, working for a boss, etc.).
- draftStrategy.dream = aspiration titles boards understand; bridge = hireable footholds toward the star; never = cliffs.
- For self-employed / investor / trader / founder paths: still fill bridge with realistic near-term footholds when needed; never = employment cliffs they named.
- Default stretchTolerance to show_stretch when they have ambition beyond hireable-now.
- When isComplete=true, draftIntent and draftStrategy MUST be fully populated.
- ENUM SAFETY: workSetting and stretchTolerance must be exact enum tokens above — never Dutch free text in those fields.

${formatCareerLadderForPrompt(input.context) || ""}

Return JSON:
{
  "assistantMessage": "...",
  "isComplete": false,
  "clarifyingQuestion": "...",
  "draftIntent": {
    "northStar": "",
    "narrative": "",
    "antiGoals": [],
    "workSetting": "flexible",
    "horizonNow": [],
    "horizonSixMonths": [],
    "horizonTwoYears": [],
    "stretchTolerance": "show_stretch",
    "moneyFloor": "",
    "nonNegotiables": [],
    "openQuestions": []
  },
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
  } catch (e) {
    console.warn("[Career intake] structured turn failed:", e);
    const nl = input.language !== "en";
    return {
      assistantMessage: nl
        ? "Even een korte hapering aan mijn kant — je antwoord is genoteerd in de chat. Kun je kort bevestigen of je vooral flexibel/thuis wilt werken, of liever hybride/kantoor? Daarna gaan we verder."
        : "Small glitch on my side — your answer is still in the chat. Quick confirm: mostly flexible/home, or hybrid/office? Then we'll continue.",
      isComplete: false,
    };
  }

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
