import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeTailoredSearchPlan } from "@/lib/gemini/coerce";
import {
  formatContextForPrompt,
  formatCareerLadderForPrompt,
  getLadderSearchQueriesFromContext,
  getTopInferredRolesFromContext,
} from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { ExperienceLevel } from "@/lib/types";
import {
  genericFallbackQueries,
  guessQueryLanguage,
  resolveJobSearchLanguage,
  searchLanguageAutoDecisionBlock,
  searchLanguageLockedBlock,
  type JobSearchLanguageSetting,
  type ResolvedJobSearchLanguage,
  type SearchLanguageStrategy,
  type SearchQueryPlan,
} from "@/lib/job-search/locale";
import { getEnabledTargetSearchQueries } from "@/lib/job-search/target-roles";
import { ETHOS_AGENT_BLOCK } from "@/lib/career/ethos";
import {
  getLaneQueries,
  laneQueriesToPlans,
  shouldUseStrategyLanes,
} from "@/lib/job-search/strategy";
import {
  synthesizeBoardQueriesFromIntent,
  fallbackBoardQueriesFromIntent,
} from "@/lib/job-search/intent-queries";

export type { SearchQueryPlan, SearchLanguageStrategy };

export interface TailoredSearchPlan {
  /** Flat query strings for backward compatibility */
  queries: string[];
  /** Per-query language tags chosen by AI */
  queryPlans: SearchQueryPlan[];
  inferredLevel: ExperienceLevel;
  rationale: string;
  /** Why single vs mixed (AI) */
  languageRationale: string;
  languageStrategy: SearchLanguageStrategy;
  /** Dominant query language */
  language: ResolvedJobSearchLanguage;
}

const searchQueryItemSchema = z.object({
  query: z.string(),
  language: z.enum(["nl", "en"]),
  /** next = hireable-now ladder destination; stretch = bigger same-craft scope */
  intent: z.enum(["next", "stretch"]).optional(),
});

const tailoredSearchSchema = z.object({
  inferredExperienceLevel: z.enum([
    "junior",
    "mid",
    "senior",
    "staff",
    "principal",
  ]),
  searchLanguageStrategy: z.enum(["single", "mixed"]),
  primarySearchLanguage: z.enum(["nl", "en"]),
  searchQueries: z.array(searchQueryItemSchema).min(2).max(4),
  languageRationale: z.string(),
  rationale: z.string(),
});

const LEVEL_MODIFIERS: Record<
  ExperienceLevel,
  { prefixed: string[]; fallback: string }
> = {
  junior: { prefixed: ["junior", "entry level"], fallback: "graduate" },
  mid: { prefixed: [], fallback: "" },
  senior: { prefixed: ["senior"], fallback: "" },
  staff: { prefixed: ["staff", "principal"], fallback: "senior" },
  principal: { prefixed: ["principal", "staff"], fallback: "senior" },
};

function normalizeRoleTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(
      /\b(senior|junior|lead|principal|staff|sr\.?|entry[- ]?level|graduate|intern|associate)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function inferExperienceLevelFromContext(
  ctx: CandidateContext
): ExperienceLevel {
  if (ctx.structuredProfile?.experienceLevel) {
    return ctx.structuredProfile.experienceLevel;
  }

  const titles = (ctx.resumeStructured?.experience ?? [])
    .map((e) => e.title.toLowerCase())
    .join(" ");

  if (/\b(intern|graduate|junior|entry[- ]?level|starter|trainee)\b/.test(titles)) {
    return "junior";
  }
  if (/\b(principal|staff|distinguished)\b/.test(titles)) {
    return "principal";
  }
  if (/\b(senior|sr\.?|lead|architect|manager)\b/.test(titles)) {
    return "senior";
  }

  const jobCount = ctx.resumeStructured?.experience?.length ?? 0;
  if (jobCount <= 1) return "junior";
  if (jobCount <= 3) return "mid";
  return "mid";
}

function buildFallbackQueryPlans(
  ctx: CandidateContext,
  level: ExperienceLevel,
  language: ResolvedJobSearchLanguage
): SearchQueryPlan[] {
  const ladderQueries = getLadderSearchQueriesFromContext(ctx, 4);
  const plans: SearchQueryPlan[] = ladderQueries.map((query) => ({
    query,
    language: guessQueryLanguage(query) === "nl" ? "nl" : language,
  }));

  const rawRoles = getTopInferredRolesFromContext(ctx, 3);
  const roles = rawRoles.map(normalizeRoleTitle).filter((r) => r.length >= 3);
  const modifiers = LEVEL_MODIFIERS[level];

  for (let i = 0; i < roles.length && plans.length < 3; i++) {
    const role = roles[i];
    let query = role;
    if (level === "junior" && i < 2) {
      const prefix = modifiers.prefixed[i % modifiers.prefixed.length];
      query = `${prefix} ${role}`.trim();
    } else if (modifiers.prefixed.length > 0 && i === 0) {
      query = `${modifiers.prefixed[0]} ${role}`.trim();
    }
    const lang = guessQueryLanguage(query);
    if (!plans.some((p) => p.query === query)) {
      plans.push({ query, language: lang });
    }
  }

  for (const q of genericFallbackQueries(level, language)) {
    if (plans.length >= 4) break;
    if (!plans.some((p) => p.query === q)) {
      plans.push({ query: q, language: guessQueryLanguage(q) });
    }
  }

  const seen = new Set<string>();
  return plans
    .filter((p) => {
      const key = p.query.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function applyUserLanguageLock(
  plans: SearchQueryPlan[],
  userSetting: JobSearchLanguageSetting
): {
  queryPlans: SearchQueryPlan[];
  languageStrategy: SearchLanguageStrategy;
  language: ResolvedJobSearchLanguage;
} {
  const locked =
    userSetting === "nl" || userSetting === "en"
      ? userSetting
      : null;

  if (locked) {
    return {
      queryPlans: plans.map((p) => ({ query: p.query, language: locked })),
      languageStrategy: "single",
      language: locked,
    };
  }

  const primary: ResolvedJobSearchLanguage =
    plans.filter((p) => p.language === "nl").length >=
    plans.filter((p) => p.language === "en").length
      ? "nl"
      : "en";
  const secondary: ResolvedJobSearchLanguage = primary === "nl" ? "en" : "nl";
  const secondaryCount = plans.filter((p) => p.language === secondary).length;
  const strategy: SearchLanguageStrategy =
    secondaryCount > 0 ? "mixed" : "single";

  // Cap secondary language slots at 2
  let secondaryUsed = 0;
  const capped = plans.map((p) => {
    if (p.language === secondary) {
      if (secondaryUsed >= 2) {
        return { query: p.query, language: primary };
      }
      secondaryUsed++;
    }
    return p;
  });

  const finalSecondary = capped.filter((p) => p.language === secondary).length;
  return {
    queryPlans: capped,
    languageStrategy: finalSecondary > 0 ? "mixed" : "single",
    language: primary,
  };
}

function finalizeSearchPlan(
  queryPlans: SearchQueryPlan[],
  inferredLevel: ExperienceLevel,
  rationale: string,
  languageRationale: string,
  userSetting: JobSearchLanguageSetting
): TailoredSearchPlan {
  const normalized: SearchQueryPlan[] = queryPlans
    .map((p) => ({
      query: p.query.trim().toLowerCase(),
      language: (p.language === "nl" ? "nl" : "en") as ResolvedJobSearchLanguage,
    }))
    .filter((p) => p.query.length >= 3 && p.query.split(/\s+/).length <= 6);

  const { queryPlans: locked, languageStrategy, language } =
    applyUserLanguageLock(normalized, userSetting);

  return {
    queries: locked.map((p) => p.query),
    queryPlans: locked,
    inferredLevel,
    rationale: rationale.trim() || "AI-tailored ideal-next-role search",
    languageRationale: languageRationale.trim() || "",
    languageStrategy,
    language,
  };
}

/** AI infers seniority, search language strategy, and board-ready queries. */
export async function generateTailoredSearchPlan(
  context: CandidateContext,
  options?: {
    searchLanguage?: JobSearchLanguageSetting;
    emptyFunnel?: boolean;
  }
): Promise<TailoredSearchPlan> {
  const userSetting =
    options?.searchLanguage ??
    context.profile.settings.jobSearchLanguage ??
    "auto";
  const emptyFunnel = options?.emptyFunnel === true;
  const heuristicLevel = inferExperienceLevelFromContext(context);
  const fallbackLang = resolveJobSearchLanguage(context, userSetting);

  // Strategy / intent / targets — AI synthesizes board-ready queries (not raw dream sentences).
  if (shouldUseStrategyLanes(context.profile) || emptyFunnel) {
    const synthesized = await synthesizeBoardQueriesFromIntent(context, {
      emptyFunnel,
      language: fallbackLang,
      experienceLevel: heuristicLevel,
    });
    if (synthesized && synthesized.queryPlans.length >= 2) {
      return finalizeSearchPlan(
        synthesized.queryPlans,
        heuristicLevel,
        `${emptyFunnel ? "Empty-funnel · " : ""}${synthesized.rationale}`,
        `Intent→board query language bias: ${fallbackLang}`,
        userSetting
      );
    }

    const fallbackPlans = fallbackBoardQueriesFromIntent(context, {
      emptyFunnel,
      language: fallbackLang,
    });
    if (fallbackPlans.length >= 2) {
      return finalizeSearchPlan(
        fallbackPlans,
        heuristicLevel,
        emptyFunnel
          ? `Empty-funnel fallback lanes: ${fallbackPlans.map((p) => p.query).join(", ")}`
          : `Sanitized strategy/target lanes: ${fallbackPlans.map((p) => p.query).join(", ")}`,
        `Lane language bias: ${fallbackLang}`,
        userSetting
      );
    }

    // Last resort: old deterministic lanes
    const laneQueries = getLaneQueries(context.profile, {
      emptyFunnel,
      language: fallbackLang,
    });
    if (laneQueries.length >= 2) {
      return finalizeSearchPlan(
        laneQueriesToPlans(laneQueries, fallbackLang),
        heuristicLevel,
        `Raw lane fallback: ${laneQueries.join(", ")}`,
        `Lane language bias: ${fallbackLang}`,
        userSetting
      );
    }
  }

  const isLocked = userSetting === "nl" || userSetting === "en";
  const languageBlock = isLocked
    ? searchLanguageLockedBlock(userSetting)
    : searchLanguageAutoDecisionBlock(context);

  const candidateBlock = formatContextForPrompt(context, 14000);
  const seedRoles = getTopInferredRolesFromContext(context, 5).map(
    normalizeRoleTitle
  );
  const ladderQueries = getLadderSearchQueriesFromContext(context, 6);
  const ladderBlock = formatCareerLadderForPrompt(context);
  const jobPrefs = context.profile.jobPreferences?.trim();
  const targetQueries = getEnabledTargetSearchQueries(context.profile);
  const hasTargetRoles = targetQueries.length > 0;

  try {
    const targetBlock = hasTargetRoles
      ? `
USER-SELECTED TARGET ROLES (HARD — these MUST appear as search queries):
${targetQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

QUERY SLOT RULES WHEN TARGETS ARE SET:
- Put the ${Math.min(3, targetQueries.length)} enabled target role(s) as intent="next" queries (use the phrases above, lightly normalize casing only).
- Exactly ONE remaining query may be intent="stretch" (related same-craft scope step OR a close variant not already listed).
- Do NOT replace target roles with warehouse/floor titles just because the CV looks junior for the target.
- Hireability warnings are informational; still search the enabled targets.`
      : `
HIREABILITY FIRST (judgment — no keyword blacklists):
- Ask: "Would a realistic employer interview them for this title with THIS CV?" If no → do not search it.
- Prefer CAREER LADDER nextRoles / their searchQuery phrases when those are hireable from evidence.
- Prefer SAME-CRAFT scope step-ups (bigger team/site/warehouse/floor leadership) over inventing a new specialty profession.
- Tools they can learn on the job are fine to search around (supervisor roles that use WMS). Specialty crafts they never practiced are not (planner / S&OP / ERP specialist / demand planning / white-collar coordinator-only titles) unless the CV already shows that craft OR the user enabled that title as a target role.
- At most ONE query may closely mirror their current job title.
- At most ONE query may be intent="stretch" (bigger same-craft scope). The other 3 MUST be intent="next" (near-term hireable).
- NEVER force VP/Director/C-level without leadership evidence.
- Preferences are soft: at most one query may reflect preferred sector/comp language.
- Vary queries; do not repeat the same role family four times.
- Do NOT invent experience; DO invent plausible NEXT role directions supported by skills they already demonstrated.`;

    const result = await generateStructured(
      `Design a FULLY AI-powered job board search plan that explores the PATH toward this candidate's north star — hireable footholds plus careful stretch, not dream prose as keywords.

${ETHOS_AGENT_BLOCK}

Read their entire resume, LinkedIn, portfolio, preferences, Career Intent if present, and CAREER LADDER.

${ladderBlock || "No career ladder yet — invent 4 hireable-now foothold queries from transferable strengths (same craft + mild scope step-ups toward their prefs/Intent)."}

STEP 1 — Infer REALISTIC target experience level from evidence of ownership/years/titles:
- Levels: junior | mid | senior | staff | principal
- Aim one step up when the profile supports a same-craft climb toward the star

STEP 2 — Decide search language strategy (single vs mixed) using the framework below.

STEP 3 — Produce exactly 4 LinkedIn/Indeed keyword queries (2–5 words; never founder/north-star sentences).

${languageBlock}

${targetBlock}

QUERY RULES:
- 2-5 words each; role-style phrases boards understand
- Tag each query with intent "next" or "stretch"
- Language tag per query (nl/en) must match the strategy
- Prefer footholds (next) over stretch; respect Never / anti-goals

Ladder search seeds (use or refine — drop any seed that requires a craft they lack, unless it is a user-enabled target): ${ladderQueries.join(", ") || "none — invent from profile"}
Seed role hints: ${seedRoles.join(", ") || "infer freely from resume"}
Heuristic level hint: ${heuristicLevel}
${jobPrefs ? `Job preferences (soft bias only): ${jobPrefs}` : "No special job preferences."}

Return JSON:
{
  "inferredExperienceLevel": "mid",
  "searchLanguageStrategy": "single" | "mixed",
  "primarySearchLanguage": "nl" | "en",
  "searchQueries": [
    { "query": "teamleider logistiek", "language": "nl", "intent": "next" },
    { "query": "magazijn supervisor", "language": "nl", "intent": "next" },
    { "query": "voorraadbeheerder", "language": "nl", "intent": "next" },
    { "query": "operations supervisor", "language": "en", "intent": "stretch" }
  ],
  "languageRationale": "why single or mixed",
  "rationale": "short explanation of the hireable-now ladder strategy"
}

CANDIDATE:
${candidateBlock}`,
      tailoredSearchSchema,
      {
        userId: context.userId,
        operation: "job_search_queries",
        coerce: normalizeTailoredSearchPlan,
      }
    );

    let queryPlans: SearchQueryPlan[] = result.searchQueries.map((item) => ({
      query: item.query,
      language: item.language,
    }));

    if (hasTargetRoles) {
      queryPlans = mergeTargetRoleQueries(
        targetQueries,
        queryPlans,
        resolveJobSearchLanguage(context, userSetting)
      );
    }

    if (queryPlans.length >= 2) {
      return finalizeSearchPlan(
        queryPlans,
        result.inferredExperienceLevel,
        hasTargetRoles
          ? `${result.rationale} | User targets: ${targetQueries.join(", ")}`
          : result.rationale,
        result.languageRationale,
        userSetting
      );
    }
  } catch (e) {
    console.warn("[Job search] Tailored query generation failed:", e);
  }

  const level = heuristicLevel;
  let fallbackPlans = buildFallbackQueryPlans(context, level, fallbackLang);
  if (hasTargetRoles) {
    fallbackPlans = mergeTargetRoleQueries(
      targetQueries,
      fallbackPlans,
      fallbackLang
    );
  }
  return finalizeSearchPlan(
    fallbackPlans,
    level,
    hasTargetRoles
      ? `Fallback with user targets: ${targetQueries.join(", ")}`
      : `Fallback ${level}-level queries from profile heuristics`,
    `Fallback language: ${fallbackLang}`,
    userSetting
  );
}

/** Force enabled targets into the first slots; keep one AI/stretch slot. */
function mergeTargetRoleQueries(
  targetQueries: string[],
  aiPlans: SearchQueryPlan[],
  defaultLang: ResolvedJobSearchLanguage
): SearchQueryPlan[] {
  const targets = targetQueries.slice(0, 3).map((query) => ({
    query,
    language:
      guessQueryLanguage(query) === "nl"
        ? ("nl" as const)
        : defaultLang,
  }));

  const targetKeys = new Set(targets.map((t) => t.query.trim().toLowerCase()));
  const extras = aiPlans.filter(
    (p) => !targetKeys.has(p.query.trim().toLowerCase())
  );

  const merged = [...targets];
  for (const extra of extras) {
    if (merged.length >= 4) break;
    merged.push(extra);
  }

  // If AI returned nothing useful, pad with targets only.
  return merged.slice(0, 4);
}

export function seniorityLabel(level: ExperienceLevel): string {
  const labels: Record<ExperienceLevel, string> = {
    junior: "Junior / entry-level",
    mid: "Mid-level",
    senior: "Senior",
    staff: "Staff",
    principal: "Principal",
  };
  return labels[level];
}
