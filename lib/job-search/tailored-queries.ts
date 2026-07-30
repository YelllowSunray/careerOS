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
  options?: { searchLanguage?: JobSearchLanguageSetting }
): Promise<TailoredSearchPlan> {
  const userSetting =
    options?.searchLanguage ??
    context.profile.settings.jobSearchLanguage ??
    "auto";
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
  const heuristicLevel = inferExperienceLevelFromContext(context);
  const jobPrefs = context.profile.jobPreferences?.trim();

  try {
    const result = await generateStructured(
      `Design a FULLY AI-powered job board search plan for this candidate's IDEAL NEXT ROLES — roles an employer would hire them for SOON.

Read their entire resume, LinkedIn, portfolio, preferences, and CAREER LADDER.

${ladderBlock || "No career ladder yet — invent 4 hireable-now queries from transferable strengths (same craft + mild scope step-ups)."}

STEP 1 — Infer REALISTIC target experience level from evidence of ownership/years/titles:
- Levels: junior | mid | senior | staff | principal
- Aim one step up when the profile supports a same-craft ladder climb

STEP 2 — Decide search language strategy (single vs mixed) using the framework below.

STEP 3 — Produce exactly 4 LinkedIn/Indeed keyword queries that find HIREABLE-NOW ideal next jobs.

${languageBlock}

HIREABILITY FIRST (judgment — no keyword blacklists):
- Ask: "Would a realistic employer interview them for this title with THIS CV?" If no → do not search it.
- Prefer CAREER LADDER nextRoles / their searchQuery phrases when those are hireable from evidence.
- Prefer SAME-CRAFT scope step-ups (bigger team/site/warehouse/floor leadership) over inventing a new specialty profession.
- Tools they can learn on the job are fine to search around (supervisor roles that use WMS). Specialty crafts they never practiced are not (planner / S&OP / ERP specialist / demand planning / white-collar coordinator-only titles) unless the CV already shows that craft.
- At most ONE query may closely mirror their current job title.
- At most ONE query may be intent="stretch" (bigger same-craft scope). The other 3 MUST be intent="next" (near-term hireable).
- NEVER force VP/Director/C-level without leadership evidence.
- Preferences are soft: at most one query may reflect preferred sector/comp language.
- Vary queries; do not repeat the same role family four times.
- Do NOT invent experience; DO invent plausible NEXT role directions supported by skills they already demonstrated.

QUERY RULES:
- 2-5 words each; role-style phrases boards understand
- Tag each query with intent "next" or "stretch"
- Language tag per query (nl/en) must match the strategy

Ladder search seeds (use or refine — drop any seed that requires a craft they lack): ${ladderQueries.join(", ") || "none — invent from profile"}
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

    const queryPlans: SearchQueryPlan[] = result.searchQueries.map((item) => ({
      query: item.query,
      language: item.language,
    }));

    if (queryPlans.length >= 2) {
      return finalizeSearchPlan(
        queryPlans,
        result.inferredExperienceLevel,
        result.rationale,
        result.languageRationale,
        userSetting
      );
    }
  } catch (e) {
    console.warn("[Job search] Tailored query generation failed:", e);
  }

  const fallbackLang = resolveJobSearchLanguage(context, userSetting);
  const level = heuristicLevel;
  const fallbackPlans = buildFallbackQueryPlans(context, level, fallbackLang);
  return finalizeSearchPlan(
    fallbackPlans,
    level,
    `Fallback ${level}-level queries from profile heuristics`,
    `Fallback language: ${fallbackLang}`,
    userSetting
  );
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
