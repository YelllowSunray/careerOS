import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeJobMatch } from "@/lib/gemini/coerce";
import { formatContextForPrompt } from "@/lib/candidate/context";
import { getPrimaryCountry } from "@/lib/job-search/countries";
import { inferExperienceLevelFromContext, seniorityLabel } from "@/lib/job-search/tailored-queries";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Job } from "@/lib/types";

const matchSchema = z.object({
  fitScore: z.number(),
  contributionScore: z.number(),
  learningScore: z.number(),
  moneyScore: z.number(),
  strengths: z.array(z.string()),
  missingSkills: z.array(
    z.object({
      skill: z.string(),
      isHardRequirement: z.boolean(),
    })
  ),
  applyRecommendation: z.boolean(),
  reasoning: z.string(),
  contributionNotes: z.string(),
  learningNotes: z.string(),
  moneyNotes: z.string(),
  preferenceAlignment: z.string(),
  preferencesMatch: z.boolean(),
  /** Languages the posting requires (empty if none / English-only optional / not stated). */
  requiredLanguages: z.array(z.string()),
  /** True if candidate speaks every required language (or no hard language req). */
  languageRequirementMet: z.boolean(),
  languageNotes: z.string(),
  employerType: z.string().optional(),
});

export type JobMatchResult = z.infer<typeof matchSchema>;

function buildHolisticMatchPrompt(
  context: CandidateContext,
  jobBlock: string
): string {
  const candidateBlock = formatContextForPrompt(context, 18000);
  const workPref = context.profile.workPreference;
  const countries = getPrimaryCountry(context.profile.preferredCountries) ?? "any";
  const jobPrefs = context.profile.jobPreferences?.trim();
  const spoken = (context.profile.languagesSpoken ?? []).filter(Boolean);
  const targetLevel = inferExperienceLevelFromContext(context);

  const languageBlock =
    spoken.length > 0
      ? `CANDIDATE LANGUAGES SPOKEN (HARD ELIGIBILITY — not soft preferences):
${spoken.join(", ")}

Rules:
- Infer requiredLanguages from the posting (explicit "must speak Dutch", "Dutch required", bilingual NL/EN as hard req, etc.).
- Nice-to-have / preferred / "Dutch is a plus" → do NOT treat as required.
- Posting written in Dutch does NOT alone mean Dutch is required unless the role requires speaking/working in Dutch.
- If English-only is fine or no language requirement is stated → requiredLanguages=[] and languageRequirementMet=true.
- languageRequirementMet=false ONLY when a hard required language is missing from the candidate list (dialects/aliases OK, e.g. Nederlands≈Dutch).
- If languagesSpoken is empty, treat as unable to confirm — fail any clear non-English hard requirement.`
      : `CANDIDATE LANGUAGES SPOKEN: (not set)
If the posting has a clear hard language requirement other than optional English, set languageRequirementMet=false.
If no hard language requirement, languageRequirementMet=true and requiredLanguages=[].`;

  const preferenceBlock = jobPrefs
    ? `
CANDIDATE JOB PREFERENCES (free text — soft context for all three pillars, not a veto):
"""
${jobPrefs}
"""
Interpret salary/comp lines in prefs as input to moneyScore.
Interpret sector/role lines as soft bias on contribution & learning — never hard-reject adjacent sectors.`
    : `
No free-text job preferences.
Work preference: ${workPref}
Preferred locations: ${countries}
Set preferencesMatch=true and preferenceAlignment="No specific job preferences stated."`;

  return `You are an expert career coach finding the candidate's IDEAL NEXT ROLE — not a clone of their current job title.

Core idea: ladder climbing and better contribution × learning × money. The next role does NOT need to stay in the same job family/branch.
Example: a Compliance Officer may ideal-match Senior Compliance, but also Risk, AML leadership, Regulatory Affairs, Governance, Privacy, Policy, Legal Ops, FinCrime, or other paths their FULL profile supports — if they can contribute soon, learn upward, and earn well.

THE THREE PILLARS (score each 0-100 from the full profile + posting — pure judgment, no keyword rules):

1) CONTRIBUTION — Can they create real value here soon?
   Map transferable strengths (judgment, ownership, domain fluency, stakeholder skills) onto THIS role's needs — even if the title differs from their current one.
   High = meaningful impact within months; low = years of catch-up or wrong craft entirely.

2) LEARNING — Does this raise their ceiling?
   New scope, harder problems, leadership, new markets/tools/licenses they can absorb, clear step up the ladder.
   Same-title lateral moves with no new scope score lower than a different-branch stretch that expands capability.

3) MONEY — Compensation quality vs level and prefs.
   Use disclosed pay when present; otherwise infer plausibly from level/employer/market/location and note uncertainty.
   Factor compensation hints in preferences. Do not invent exact figures.

OVERALL fitScore (0-100):
- Maximize the beautiful balance of contribution × learning × money.
- Prefer IDEAL next jobs: stronger ladder + solid contribution + good money.
- DO NOT require the job title or branch to match their current title.
- DO NOT penalize cross-branch moves when transfer is credible from the full profile.
- Mild seniority stretch (+1) is welcome when contribution stays credible.
- Only tank scores for clear wrong-career mismatches (entirely unrelated profession).

TARGET SENIORITY BASELINE: ${seniorityLabel(targetLevel)} (stretch up is encouraged when earned by the profile).

${preferenceBlock}

${languageBlock}

preferencesMatch: soft true/false vs stated prefs (informational only — never veto an ideal ladder move).
languageRequirementMet: HARD gate — false means this job must not be shown to the candidate.
employerType: short label from the posting.

Return ONLY valid JSON:
{
  "fitScore": 0-100,
  "contributionScore": 0-100,
  "learningScore": 0-100,
  "moneyScore": 0-100,
  "strengths": ["string"],
  "missingSkills": [{ "skill": "string", "isHardRequirement": true/false }],
  "applyRecommendation": true/false,
  "reasoning": "2-4 sentences on why this is (or isn't) an ideal next role — include branch/ladder angle",
  "contributionNotes": "1-2 sentences",
  "learningNotes": "1-2 sentences",
  "moneyNotes": "1-2 sentences (note if pay inferred vs disclosed)",
  "preferenceAlignment": "1-2 sentences (soft)",
  "preferencesMatch": true/false,
  "requiredLanguages": ["string"],
  "languageRequirementMet": true/false,
  "languageNotes": "1 sentence on language eligibility",
  "employerType": "short label"
}

CANDIDATE (resume + LinkedIn + portfolio + profile):
${candidateBlock}

JOB:
${jobBlock}`;
}

function clampScore(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, Math.round(v)));
}

function normalizeMatchResult(
  result: JobMatchResult,
  hasPrefs: boolean
): JobMatchResult {
  return {
    ...result,
    fitScore: clampScore(result.fitScore),
    contributionScore: clampScore(result.contributionScore),
    learningScore: clampScore(result.learningScore),
    moneyScore: clampScore(result.moneyScore, 50),
    contributionNotes: result.contributionNotes?.trim() || "",
    learningNotes: result.learningNotes?.trim() || "",
    moneyNotes: result.moneyNotes?.trim() || "",
    preferencesMatch: hasPrefs
      ? Boolean(result.preferencesMatch)
      : (result.preferencesMatch ?? true),
    preferenceAlignment:
      result.preferenceAlignment ||
      (hasPrefs
        ? "Preference alignment not detailed."
        : "No specific job preferences stated."),
    requiredLanguages: Array.isArray(result.requiredLanguages)
      ? result.requiredLanguages.map((l) => String(l).trim()).filter(Boolean)
      : [],
    languageRequirementMet: Boolean(result.languageRequirementMet),
    languageNotes: result.languageNotes?.trim() || "",
  };
}

/** Deep AI match: contribution × learning × money balance. */
export async function matchListingToCandidate(
  context: CandidateContext,
  listing: {
    title: string;
    company: string;
    location?: string;
    url: string;
  },
  postingText: string
): Promise<JobMatchResult> {
  const hasPrefs = Boolean(context.profile.jobPreferences?.trim());
  const jobBlock = `Title: ${listing.title}
Company: ${listing.company}
Location: ${listing.location ?? "unknown"}
URL: ${listing.url}

FULL JOB POSTING:
${postingText.slice(0, 14000)}`;

  const result = await generateStructured(
    buildHolisticMatchPrompt(context, jobBlock),
    matchSchema,
    {
      userId: context.userId,
      operation: "listing_match",
      coerce: normalizeJobMatch,
    }
  );
  return normalizeMatchResult(result, hasPrefs);
}

export async function matchJobToCandidate(job: Job, context: CandidateContext) {
  const hasPrefs = Boolean(context.profile.jobPreferences?.trim());
  const jobBlock = JSON.stringify({
    title: job.title,
    company: job.company,
    requirements: job.requirements,
    description: job.description.slice(0, 8000),
    location: job.location,
  });

  const result = await generateStructured(
    buildHolisticMatchPrompt(context, jobBlock),
    matchSchema,
    {
      userId: context.userId,
      operation: "job_match",
      coerce: normalizeJobMatch,
    }
  );
  return normalizeMatchResult(result, hasPrefs);
}
