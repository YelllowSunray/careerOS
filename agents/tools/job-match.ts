import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeJobMatch } from "@/lib/gemini/coerce";
import {
  formatContextForPrompt,
  formatCareerLadderForPrompt,
} from "@/lib/candidate/context";
import { getPrimaryCountry } from "@/lib/job-search/countries";
import { inferExperienceLevelFromContext, seniorityLabel } from "@/lib/job-search/tailored-queries";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Job, JobPathType } from "@/lib/types";
import {
  hasUnmetHardRequirements,
  isSkillIneligible,
} from "@/lib/job-search/hard-requirements";

const matchSchema = z.object({
  fitScore: z.number(),
  contributionScore: z.number(),
  learningScore: z.number(),
  moneyScore: z.number(),
  scopeIncrease: z.number(),
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
  scopeNotes: z.string(),
  preferenceAlignment: z.string(),
  preferencesMatch: z.boolean(),
  requiredLanguages: z.array(z.string()),
  languageRequirementMet: z.boolean(),
  languageNotes: z.string(),
  /** False = do not show — candidate lacks core skill/credential fit for this role. */
  skillRequirementMet: z.boolean(),
  skillNotes: z.string(),
  pathType: z.enum(["step", "stretch", "destination", "lateral"]),
  ladderPath: z.string(),
  matchedDestination: z.string().optional(),
  employerType: z.string().optional(),
});

export type JobMatchResult = z.infer<typeof matchSchema>;

function buildHolisticMatchPrompt(
  context: CandidateContext,
  jobBlock: string
): string {
  const candidateBlock = formatContextForPrompt(context, 18000);
  const ladderBlock = formatCareerLadderForPrompt(context);
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

  const ladderScoringBlock = ladderBlock
    ? `
${ladderBlock}

LADDER MATCHING RULES:
- Score this job against ladder DESTINATIONS (next + stretch), not "does the title match the CV".
- Prefer same-title BIGGER SCOPE and adjacent-title BROADER OWNERSHIP over lateral clones.
- pathType:
  - "step": maps to a nextRoles destination (~0–18 months) or unlocks one soon
  - "stretch": maps to a stretchRoles destination or clear ambitious climb
  - "destination": strong direct hit on a ladder title (next or stretch)
  - "lateral": same scope / title synonym with no meaningful climb — score lower
- matchedDestination: ladder title this job maps to (or omit if none)
- ladderPath: one sentence path, e.g. "This Risk Analyst role → positions you for Senior Compliance / Governance in 1–2 moves"
- scopeIncrease (0-100): team size, budget, stakeholders, decision rights, market size, IC→lead — NOT title synonymy. Lateral clones ≤35.`
    : `
No career ladder cached — still score scopeIncrease vs current role evidence.
Prefer scope step-ups and adjacent moves over lateral title clones.
pathType: step | stretch | destination | lateral as best judgment.
ladderPath: one sentence on how this job compounds into a bigger jump.`;

  return `You are an expert career coach finding the candidate's IDEAL NEXT ROLE on their career ladder — not a clone of their current job title.

Core idea: ladder climbing via contribution × learning × money × SCOPE INCREASE. Slight sector moves that raise scope (Compliance → Risk/AML/Privacy) are first-class wins.

THE THREE PILLARS (score each 0-100 from the full profile + posting — pure judgment, no keyword rules):

1) CONTRIBUTION — Can they create real value here soon?
   Map transferable strengths onto THIS role — even if the title differs.
   High = meaningful impact within months; low = years of catch-up or wrong craft entirely.

2) LEARNING — Does this raise their ceiling?
   New scope, harder problems, leadership, new markets/tools/licenses, clear step up.
   Same-title lateral moves with no new scope score lower than an adjacent stretch that expands capability.

3) MONEY — Compensation quality vs level and prefs.
   Use disclosed pay when present; otherwise infer plausibly and note uncertainty.

SCOPE INCREASE (0-100) — fourth signal, explicit:
- Bigger ownership: team, budget, stakeholders, decision rights, market, IC→lead.
- Rank "same title, bigger scope" and "adjacent title, broader ownership" ABOVE lateral clones.
- Low score for title synonyms with identical scope.

OVERALL fitScore (0-100):
- Maximize contribution × learning × money, heavily weighted by scopeIncrease and ladder fit.
- Prefer step/stretch/destination over lateral.
- DO NOT require the job title or branch to match their current title.
- Mild seniority stretch (+1) is welcome when contribution stays credible.
- Only tank scores for clear wrong-career mismatches.

TARGET SENIORITY BASELINE: ${seniorityLabel(targetLevel)} (stretch up is encouraged when earned by the profile).

${preferenceBlock}

${languageBlock}

${ladderScoringBlock}

preferencesMatch: soft true/false vs stated prefs (informational only — never veto an ideal ladder move).
languageRequirementMet: HARD gate — false means this job must not be shown to the candidate.

SKILL / CREDENTIAL FIT (HARD gate — AI judgment only, no keyword rules):
Set skillRequirementMet=true ONLY if the candidate can plausibly do the CORE work of this role soon using transferable evidence from their profile.
Set skillRequirementMet=false when the posting's core craft / must-haves are clearly unmet — examples of FAIL (false):
- Role is built around a stack or specialty the candidate does not have (e.g. C++ low-latency / HFT / tick-data systems for someone without that craft)
- Required degree, license, or years-in-specialty the candidate lacks when the posting treats it as essential
- Professional experience in a specialized domain (e.g. automated trading systems) with no credible transfer from the profile
- Multiple foundational must-haves missing (degree + Linux + git + domain experience) such that they are not a realistic hire for THIS posting

skillRequirementMet=true is OK when:
- Gaps are learnable nice-to-haves, tools they can pick up, or stretch items on an adjacent ladder move
- Transferable strengths make contribution credible even if the title differs (Compliance → Risk/AML/Privacy)

missingSkills rules:
- List every material gap.
- isHardRequirement=true for each gap that alone (or together) drives skillRequirementMet=false
- isHardRequirement=false for soft/stretch gaps only
- If skillRequirementMet=false, at least one missingSkills entry MUST have isHardRequirement=true
- skillNotes: 1 sentence explaining the eligibility decision

employerType: short label from the posting.

Return ONLY valid JSON:
{
  "fitScore": 0-100,
  "contributionScore": 0-100,
  "learningScore": 0-100,
  "moneyScore": 0-100,
  "scopeIncrease": 0-100,
  "strengths": ["string"],
  "missingSkills": [{ "skill": "string", "isHardRequirement": true/false }],
  "applyRecommendation": true/false,
  "reasoning": "2-4 sentences on ladder/scope angle",
  "contributionNotes": "1-2 sentences",
  "learningNotes": "1-2 sentences",
  "moneyNotes": "1-2 sentences (note if pay inferred vs disclosed)",
  "scopeNotes": "1 sentence on what scope expands",
  "preferenceAlignment": "1-2 sentences (soft)",
  "preferencesMatch": true/false,
  "requiredLanguages": ["string"],
  "languageRequirementMet": true/false,
  "languageNotes": "1 sentence on language eligibility",
  "skillRequirementMet": true/false,
  "skillNotes": "1 sentence on skill/credential eligibility",
  "pathType": "step" | "stretch" | "destination" | "lateral",
  "ladderPath": "This X role → positions you for Y in 1–2 moves",
  "matchedDestination": "ladder title or omit",
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

function coercePathType(raw: unknown): JobPathType {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (s === "step" || s === "next") return "step";
  if (s === "stretch" || s === "ambitious") return "stretch";
  if (s === "destination" || s === "target") return "destination";
  if (s === "lateral" || s === "sideways") return "lateral";
  return "step";
}

/** Mildly prefer scope climbs over lateral clones after AI scoring. */
function applyLadderFitBias(
  fitScore: number,
  scopeIncrease: number,
  pathType: JobPathType
): number {
  let score = fitScore;
  if (pathType === "lateral" && scopeIncrease < 40) {
    score = Math.round(score * 0.9);
  } else if (
    (pathType === "step" || pathType === "destination") &&
    scopeIncrease >= 55
  ) {
    score = Math.min(100, score + 4);
  } else if (pathType === "stretch" && scopeIncrease >= 50) {
    score = Math.min(100, score + 3);
  }
  return clampScore(score);
}

function normalizeMatchResult(
  result: JobMatchResult,
  hasPrefs: boolean
): JobMatchResult {
  const scopeIncrease = clampScore(result.scopeIncrease, 40);
  const pathType = coercePathType(result.pathType);
  const fitScore = applyLadderFitBias(
    clampScore(result.fitScore),
    scopeIncrease,
    pathType
  );

  const missingSkills = Array.isArray(result.missingSkills)
    ? result.missingSkills
        .map((s) => ({
          skill: String(s.skill ?? "").trim(),
          isHardRequirement: Boolean(s.isHardRequirement),
        }))
        .filter((s) => s.skill)
    : [];

  // AI skill gate — also fail if any skill was flagged hard.
  let skillRequirementMet = Boolean(result.skillRequirementMet);
  if (hasUnmetHardRequirements(missingSkills)) {
    skillRequirementMet = false;
  }

  let fitOut = fitScore;
  if (!skillRequirementMet) {
    fitOut = Math.min(fitOut, 40);
  }

  return {
    ...result,
    fitScore: fitOut,
    contributionScore: clampScore(result.contributionScore),
    learningScore: clampScore(result.learningScore),
    moneyScore: clampScore(result.moneyScore, 50),
    scopeIncrease,
    strengths: Array.isArray(result.strengths) ? result.strengths : [],
    missingSkills,
    applyRecommendation:
      Boolean(result.applyRecommendation) &&
      skillRequirementMet &&
      !isSkillIneligible({ skillRequirementMet, missingSkills }) &&
      fitOut >= 50,
    contributionNotes: result.contributionNotes?.trim() || "",
    learningNotes: result.learningNotes?.trim() || "",
    moneyNotes: result.moneyNotes?.trim() || "",
    scopeNotes: result.scopeNotes?.trim() || "",
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
    skillRequirementMet,
    skillNotes: result.skillNotes?.trim() || "",
    pathType,
    ladderPath: result.ladderPath?.trim() || "",
    matchedDestination: result.matchedDestination?.trim() || undefined,
  };
}

/** Deep AI match: contribution × learning × money × scope / ladder path. */
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
