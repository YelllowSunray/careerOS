import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeTailoredSearchPlan } from "@/lib/gemini/coerce";
import {
  formatContextForPrompt,
  getTopInferredRolesFromContext,
} from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { ExperienceLevel } from "@/lib/types";

export interface TailoredSearchPlan {
  queries: string[];
  inferredLevel: ExperienceLevel;
  rationale: string;
}

const tailoredSearchSchema = z.object({
  inferredExperienceLevel: z.enum([
    "junior",
    "mid",
    "senior",
    "staff",
    "principal",
  ]),
  searchQueries: z.array(z.string()).min(1).max(4),
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

/** Strip level words so we can re-apply the right modifier for search. */
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

/** Heuristic level when structured profile is missing. */
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

function buildFallbackQueries(
  ctx: CandidateContext,
  level: ExperienceLevel
): string[] {
  const rawRoles = getTopInferredRolesFromContext(ctx, 3);
  const roles = rawRoles.map(normalizeRoleTitle).filter((r) => r.length >= 3);
  const modifiers = LEVEL_MODIFIERS[level];
  const queries: string[] = [];

  for (let i = 0; i < roles.length && queries.length < 3; i++) {
    const role = roles[i];
    if (level === "junior" && i < 2) {
      const prefix = modifiers.prefixed[i % modifiers.prefixed.length];
      queries.push(`${prefix} ${role}`.trim());
    } else if (modifiers.prefixed.length > 0 && i === 0) {
      queries.push(`${modifiers.prefixed[0]} ${role}`.trim());
    } else {
      queries.push(role);
    }
  }

  const defaults: Record<ExperienceLevel, string[]> = {
    junior: [
      "junior frontend developer",
      "entry level web developer",
      "junior software engineer",
    ],
    mid: ["frontend developer", "full stack developer", "software engineer"],
    senior: [
      "senior frontend developer",
      "senior software engineer",
      "full stack developer",
    ],
    staff: ["staff software engineer", "principal engineer", "senior developer"],
    principal: [
      "principal engineer",
      "staff software engineer",
      "senior architect",
    ],
  };

  for (const q of defaults[level]) {
    if (queries.length >= 3) break;
    if (!queries.includes(q)) queries.push(q);
  }

  return [...new Set(queries)].slice(0, 3);
}

/** AI infers seniority + builds 3 board-ready search queries from CV/portfolio. */
export async function generateTailoredSearchPlan(
  context: CandidateContext
): Promise<TailoredSearchPlan> {
  const candidateBlock = formatContextForPrompt(context, 14000);
  const seedRoles = getTopInferredRolesFromContext(context, 5).map(
    normalizeRoleTitle
  );
  const heuristicLevel = inferExperienceLevelFromContext(context);
  const jobPrefs = context.profile.jobPreferences?.trim();

  try {
    const result = await generateStructured(
      `Design a FULLY AI-powered job board search plan for this candidate's IDEAL NEXT ROLES.

Read their entire resume, LinkedIn, portfolio, and preferences. Infer where they can climb — not only the next title in their current job branch.

STEP 1 — Infer REALISTIC target experience level from evidence of ownership/years/titles:
- Levels: junior | mid | senior | staff | principal
- Aim one step up when the profile supports ladder climb

STEP 2 — Produce exactly 4 LinkedIn/Indeed keyword queries that explore IDEAL futures.

QUERY RULES (AI judgment only — no fixed title lists):
- 2-5 words each; role-style phrases boards understand
- At most ONE query may closely mirror their current job title/branch
- At least TWO queries MUST explore different branches/families where their transferable strengths could contribute AND they would learn/climb (you invent the paths from the profile — e.g. from compliance into risk, regulatory affairs, governance, privacy, policy, fincrime leadership, etc. ONLY if credible for THIS person)
- At least ONE query should target a clear seniority step up (or broader scope leadership) when mid+
- NEVER force VP/Director/C-level for junior/mid without leadership evidence
- Preferences are soft: at most one query may reflect preferred sector/comp language
- Vary queries; do not repeat the same role family four times
- Do NOT invent experience; DO invent plausible NEXT role directions supported by their skills/achievements

Seed role hints (optional — you may diverge when better paths exist): ${seedRoles.join(", ") || "infer freely from resume"}
Heuristic level hint: ${heuristicLevel}
${jobPrefs ? `Job preferences (soft bias only): ${jobPrefs}` : "No special job preferences."}

Return JSON:
{
  "inferredExperienceLevel": "mid",
  "searchQueries": ["query one", "query two", "query three", "query four"],
  "rationale": "short explanation of the ladder / cross-branch strategy"
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

    const queries = result.searchQueries
      .map((q) => q.trim().toLowerCase())
      .filter((q) => q.length >= 3 && q.split(/\s+/).length <= 6);

    if (queries.length >= 2) {
      return {
        queries: [...new Set(queries)].slice(0, 4),
        inferredLevel: result.inferredExperienceLevel,
        rationale: result.rationale?.trim() || "AI-tailored ideal-next-role search",
      };
    }
  } catch (e) {
    console.warn("[Job search] Tailored query generation failed:", e);
  }

  const level = heuristicLevel;
  return {
    queries: buildFallbackQueries(context, level),
    inferredLevel: level,
    rationale: `Fallback ${level}-level queries from profile heuristics`,
  };
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
