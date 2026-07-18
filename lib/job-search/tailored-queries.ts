import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
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
  searchQueries: z.array(z.string()).min(1).max(3),
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
      `Design a tailored job board search plan for this candidate.

STEP 1 — Infer REALISTIC target experience level from resume + portfolio:
- Count years, job titles, project scope, and depth of ownership
- Do not inflate level based on skills alone — use evidence of roles held
- Levels: junior | mid | senior | staff | principal

STEP 2 — Produce exactly 3 search queries for LinkedIn/Indeed keyword boxes.

QUERY RULES:
- 2-5 words each; ready to paste into job board search
- Role titles only (good: "junior frontend developer") — NOT bare tech (bad: "react")
- JUNIOR: at least 2 queries MUST include "junior", "entry level", or "graduate"
- JUNIOR: 3rd query may drop the prefix to catch unlabeled roles (e.g. "frontend developer")
- MID: neutral titles without junior/senior unless preferences say otherwise
- SENIOR+: include "senior" or appropriate level term in at least 1 query
- NEVER use VP, Director, Head of, or C-level queries for junior/mid profiles
- Factor job preferences (employment type, location, remote) into query wording
- Vary across best-fit role families; do not repeat the same query
- Do NOT invent experience not evidenced in the profile

Seed roles (adapt, do not copy verbatim if too narrow): ${seedRoles.join(", ") || "infer from resume"}
Heuristic level hint: ${heuristicLevel}
${jobPrefs ? `Job preferences: ${jobPrefs}` : ""}

CANDIDATE:
${candidateBlock}`,
      tailoredSearchSchema,
      { userId: context.userId, operation: "job_search_queries" }
    );

    const queries = result.searchQueries
      .map((q) => q.trim().toLowerCase())
      .filter((q) => q.length >= 3 && q.split(/\s+/).length <= 6);

    if (queries.length >= 2) {
      return {
        queries: [...new Set(queries)].slice(0, 3),
        inferredLevel: result.inferredExperienceLevel,
        rationale: result.rationale?.trim() || "AI-tailored search plan",
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
