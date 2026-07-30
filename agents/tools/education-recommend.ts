import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeEducationRecommendations } from "@/lib/gemini/coerce";
import {
  formatCareerLadderForPrompt,
  formatContextForPrompt,
} from "@/lib/candidate/context";
import { nowIso } from "@/lib/utils/dates";
import {
  getCandidateProfile,
  getJobMatches,
  getJobs,
  saveCandidateProfile,
} from "@/services/firestore";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type {
  EducationRecommendation,
  EducationRecommendationHorizon,
  EducationRecommendationType,
  Job,
  JobMatch,
} from "@/lib/types";

const recommendationSchema = z.object({
  title: z.string(),
  type: z.enum(["certification", "course", "degree", "license", "training"]),
  provider: z.string().optional(),
  rationale: z.string(),
  closesGaps: z.array(z.string()),
  targetsLadderRoles: z.array(z.string()),
  priority: z.number(),
  horizon: z.enum(["near", "stretch"]),
  evidenceSources: z.array(
    z.enum(["market", "ladder", "profile", "knowledge"])
  ),
  marketSignalCount: z.number().optional(),
});

const educationPlanSchema = z.object({
  summary: z.string(),
  recommendations: z.array(recommendationSchema).min(1).max(6),
});

function aggregateMarketEvidence(
  jobs: Job[],
  matches: JobMatch[]
): string {
  if (jobs.length === 0 && matches.length === 0) {
    return "No matched jobs yet — rely on ladder + profile + domain knowledge.";
  }

  const matchByJob = new Map(matches.map((m) => [m.jobId, m]));
  const gapCounts = new Map<
    string,
    { count: number; learnability: string; titles: Set<string> }
  >();

  const jobLines: string[] = [];
  for (const job of jobs.slice(0, 40)) {
    const match = matchByJob.get(job.id);
    const reqs = [
      ...(job.requirements?.required ?? []).map((r) => r.skill),
      ...(job.requirements?.preferred ?? []).map((r) => `preferred:${r.skill}`),
    ];
    const skills = (job.extractedSkills ?? []).slice(0, 12);
    const gaps = (match?.missingSkills ?? [])
      .filter((s) => s.skill.trim())
      .map((s) => {
        const key = s.skill.trim().toLowerCase();
        const prev = gapCounts.get(key);
        const learn =
          s.learnability ?? (s.isHardRequirement ? "must_have" : "nice_to_have");
        if (prev) {
          prev.count += 1;
          prev.titles.add(job.title);
        } else {
          gapCounts.set(key, {
            count: 1,
            learnability: learn,
            titles: new Set([job.title]),
          });
        }
        return `${s.skill} (${learn})`;
      });

    jobLines.push(
      `- ${job.title} @ ${job.company} | path=${match?.pathType ?? "?"} | fit=${match?.fitScore ?? "?"} | craft=${match?.coreCraftFit ?? "?"}
  reqs: ${reqs.slice(0, 10).join(", ") || "—"}
  skills: ${skills.join(", ") || "—"}
  gaps: ${gaps.join("; ") || "—"}
  learningNotes: ${match?.learningNotes?.slice(0, 200) || "—"}`
    );
  }

  const rankedGaps = [...gapCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(
      ([skill, v]) =>
        `${skill} ×${v.count} [${v.learnability}] seen in: ${[...v.titles].slice(0, 4).join("; ")}`
    );

  return `MATCHED / SAVED JOBS (${jobs.length}) — treat recurring requirements as market signal for education:

AGGREGATED GAPS (most frequent first):
${rankedGaps.join("\n") || "(none)"}

PER-JOB DETAIL:
${jobLines.join("\n") || "(none)"}`;
}

function existingCredentialsBlock(context: CandidateContext): string {
  const certs = context.resumeStructured?.certifications ?? [];
  const edu = context.resumeStructured?.education ?? [];
  const certLines = certs
    .map((c) => `- ${c.name}${c.issuer ? ` (${c.issuer})` : ""}`)
    .join("\n");
  const eduLines = edu
    .map(
      (e) =>
        `- ${e.degree}${e.field ? ` in ${e.field}` : ""} @ ${e.institution}`
    )
    .join("\n");
  return `ALREADY ON CV (do NOT re-recommend these or near-duplicates):
Certifications:
${certLines || "(none listed)"}
Education:
${eduLines || "(none listed)"}`;
}

/**
 * AI recommends next certifications / courses / education using:
 * profile + ladder + LLM domain knowledge + requirements/gaps from found jobs.
 */
export async function recommendEducationPath(
  context: CandidateContext,
  evidence: { jobs: Job[]; matches: JobMatch[] }
): Promise<{
  summary: string;
  recommendations: EducationRecommendation[];
}> {
  const candidateBlock = formatContextForPrompt(context, 12000);
  const ladderBlock = formatCareerLadderForPrompt(context);
  const marketBlock = aggregateMarketEvidence(evidence.jobs, evidence.matches);
  const credentialsBlock = existingCredentialsBlock(context);

  const result = await generateStructured(
    `You are a career coach designing a PRACTICAL education / certification path that helps this candidate climb their career ladder.

Use ALL of:
1) Their CV / profile (what they already know)
2) Their CAREER LADDER next + stretch roles (where they want to go)
3) MARKET EVIDENCE from jobs already found & matched (what employers actually ask for)
4) Your domain knowledge of common credentials that unlock those roles in their region/industry

Goal: recommend 3–6 concrete next credentials (certs, short courses, licenses, targeted training — degrees only if truly necessary). Prioritize what unlocks HIREABLE next roles soon, then stretch.

If CAREER INTENT / SEARCH STRATEGY dream roles appear in the candidate block, bias recommendations toward closing gaps for those dream titles (e.g. planning craft for Logistiek Planner) while still keeping near-term attainable steps.

RULES (AI judgment — no keyword blacklists):
- Prefer credentials that close gaps appearing in MULTIPLE matched jobs or in ladder gapsToClose
- Prefer short, attainable steps over multi-year degrees unless the ladder clearly requires them
- Prefer regional / industry-recognized credentials when the candidate's market is clear (e.g. NL logistics vs US tech)
- Do NOT recommend things they already have (see CV list)
- Do NOT invent vanity certs with no hiring signal
- If market evidence is thin, lean on ladder + domain knowledge and say so in evidenceSources
- For each recommendation: explain WHY it helps THIS person climb, which gaps it closes, which ladder roles it targets
- priority: 1 = do first; higher numbers = later
- horizon: "near" = aids nextRoles soon; "stretch" = aids stretchRoles / bigger scope later
- evidenceSources: include "market" when job postings/gaps motivated it; "ladder" when ladder gaps did; "profile" when filling a profile gap; "knowledge" when industry norms did
- marketSignalCount: how many matched jobs hinted at this need (0 if knowledge/ladder only)

${ladderBlock || "No career ladder cached — infer destinations from profile."}

${credentialsBlock}

${marketBlock}

CANDIDATE:
${candidateBlock}

Return JSON:
{
  "summary": "1-2 sentence education strategy for climbing",
  "recommendations": [
    {
      "title": "short credential name",
      "type": "certification" | "course" | "degree" | "license" | "training",
      "provider": "optional issuer",
      "rationale": "why this helps them climb",
      "closesGaps": ["gap"],
      "targetsLadderRoles": ["role"],
      "priority": 1,
      "horizon": "near" | "stretch",
      "evidenceSources": ["market", "ladder"],
      "marketSignalCount": 3
    }
  ]
}`,
    educationPlanSchema,
    {
      userId: context.userId,
      operation: "education_recommend",
      coerce: normalizeEducationRecommendations,
    }
  );

  const recommendations: EducationRecommendation[] = result.recommendations
    .map((r, i) => ({
      title: r.title.trim(),
      type: r.type as EducationRecommendationType,
      provider: r.provider?.trim() || undefined,
      rationale: r.rationale.trim(),
      closesGaps: r.closesGaps.map((g) => g.trim()).filter(Boolean),
      targetsLadderRoles: r.targetsLadderRoles
        .map((t) => t.trim())
        .filter(Boolean),
      priority: Number.isFinite(r.priority) ? Math.max(1, Math.round(r.priority)) : i + 1,
      horizon: r.horizon as EducationRecommendationHorizon,
      evidenceSources: [...new Set(r.evidenceSources)],
      marketSignalCount:
        typeof r.marketSignalCount === "number"
          ? Math.max(0, Math.round(r.marketSignalCount))
          : undefined,
    }))
    .filter((r) => r.title.length >= 2)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 6);

  return {
    summary: result.summary.trim() || "Education path to unlock ladder climbs.",
    recommendations,
  };
}

/** Load jobs/matches, run AI recommend, merge onto CandidateProfile. */
export async function refreshEducationRecommendations(
  context: CandidateContext
): Promise<EducationRecommendation[]> {
  const [jobs, matches, existing] = await Promise.all([
    getJobs(context.userId),
    getJobMatches(context.userId),
    getCandidateProfile(context.userId),
  ]);

  if (!existing && !context.structuredProfile) {
    console.warn(
      "[Education] No candidate profile yet — skipping recommendations"
    );
    return [];
  }

  try {
    const plan = await recommendEducationPath(context, { jobs, matches });
    const base = existing ?? context.structuredProfile!;
    const updated = {
      ...base,
      educationRecommendations: plan.recommendations,
      educationRecommendationsSummary: plan.summary,
      educationRecommendationsGeneratedAt: nowIso(),
    };
    await saveCandidateProfile(updated);
    if (context.structuredProfile) {
      context.structuredProfile = updated;
    }
    console.log(
      `[Education] Saved ${plan.recommendations.length} recommendations (jobs=${jobs.length}, matches=${matches.length}): ${plan.recommendations.map((r) => r.title).join(" | ")}`
    );
    return plan.recommendations;
  } catch (e) {
    console.warn(
      "[Education] Recommendation failed:",
      e instanceof Error ? e.message : e
    );
    return existing?.educationRecommendations ?? [];
  }
}
