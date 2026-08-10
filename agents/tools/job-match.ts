import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeJobMatch } from "@/lib/gemini/coerce";
import {
  formatContextForPrompt,
  formatCareerLadderForPrompt,
} from "@/lib/candidate/context";
import { getPrimaryCountry } from "@/lib/job-search/countries";
import { formatCommuteForPrompt } from "@/lib/commute/helpers";
import { screenCommute } from "@/lib/commute/screening";
import { formatTargetRolesForPrompt } from "@/lib/job-search/target-roles";
import { ETHOS_AGENT_BLOCK } from "@/lib/career/ethos";
import { formatCareerIntentForPrompt } from "@/lib/job-search/career-intent";
import {
  formatWorkPreferences,
  normalizeWorkPreferences,
} from "@/lib/job-search/work-preference";
import { inferExperienceLevelFromContext, seniorityLabel } from "@/lib/job-search/tailored-queries";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Job, JobPathType } from "@/lib/types";
import {
  hasUnmetHardRequirements,
  isSkillIneligible,
  looksLikeNonLearnableGap,
  looksLikeRampableToolGap,
  normalizeCoreCraftFit,
  toMissingSkill,
} from "@/lib/job-search/hard-requirements";
import type { CoreCraftFit, GapLearnability } from "@/lib/types";

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
      learnability: z.enum(["must_have", "learn_on_job", "nice_to_have"]),
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
  /**
   * Primary skill gate (AI judgment):
   * day_one / with_ramp → show job; not_eligible → hide.
   */
  coreCraftFit: z.enum(["day_one", "with_ramp", "not_eligible"]),
  /** Derived from coreCraftFit — false only when not_eligible. */
  skillRequirementMet: z.boolean(),
  skillNotes: z.string(),
  commuteRequirementMet: z.boolean(),
  commuteNotes: z.string(),
  estimatedCommuteMinutes: z.number().optional(),
  /** false = violates user-taught feedback constraints */
  feedbackRequirementMet: z.boolean(),
  feedbackNotes: z.string(),
  pathType: z.enum(["step", "stretch", "destination", "lateral", "regressive"]),
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
  const workPref = formatWorkPreferences(
    normalizeWorkPreferences(context.profile)
  );
  const countries =
    getPrimaryCountry(context.profile.preferredCountries) ?? "any";
  const locationLabel =
    countries === "Worldwide" ? "Everywhere (all countries)" : countries;
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

  const commuteBlock = formatCommuteForPrompt(context.profile);

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
Preferred locations: ${locationLabel}
Set preferencesMatch=true and preferenceAlignment="No specific job preferences stated."`;

  const targetRolesBlock = formatTargetRolesForPrompt(context.profile);
  const intentBlock = formatCareerIntentForPrompt(context.profile);
  const northStar =
    context.profile.careerIntent?.northStar?.trim() ||
    context.profile.targetRoles?.primary?.trim() ||
    context.structuredProfile?.careerLadder?.currentRole ||
    "their next ideal role";

  const targetRolesScoring = targetRolesBlock
    ? `
${targetRolesBlock}

TARGET ROLE SCORING (soft — not a hard veto):
- Prefer jobs whose title/family aligns with enabled target roles when they also move toward the north star.
- Still apply coreCraftFit / skillRequirementMet honestly; do not invent eligibility.`
    : "";

  const pathScoringBlock = `
NORTH STAR: "${northStar}"
${intentBlock || "(No Career Intent cached — use ladder + prefs as the star proxy.)"}

${ETHOS_AGENT_BLOCK}

PATH MATCHING (distance to north star — required):
- pathType MUST be one of: destination | step | stretch | lateral | regressive
- destination: strong on-path hit (near-term destination or clear star-aligned role) AND contribution credible
- step: foothold / scope step-up that builds toward the star AND contribution credible
- stretch: toward the star but craft/seniority gap — contribution may be weaker; gaps must be honest
- lateral: same altitude; little progress toward the star — lower fit; do not recommend apply
- regressive: away from the star OR into Never/anti-goals (warehouse floor when they want office, PA when they refuse admin, etc.) — skillRequirementMet may still be true but pathType=regressive means HIDE
- matchedDestination: north-star or ladder title this maps to (or omit)
- ladderPath: one sentence naming the path, e.g. "Step toward Head of Social Impact via program delivery ownership"
- scopeIncrease (0-100): ownership climb — NOT title synonymy. Laterals ≤35. Regressive ≤25.
- applyRecommendation=true ONLY for destination/step/stretch with credible contribution — NEVER for lateral or regressive
- "No senior" prefs mean: fail hard senior must-haves they cannot meet — NOT ban every next-rung title that contains Senior when it is a natural step toward the star and contribution is credible

${ladderBlock ? `${ladderBlock}\nUse ladder next/stretch as footholds toward the north star when Intent is thin.` : "No career ladder cached — still path-score vs north star + current role evidence."}`;

  return `You are Career OS — an expert career partner guiding this candidate toward their NORTH STAR ideal next roles.

${ETHOS_AGENT_BLOCK}

Core idea: guide via contribution × learning × money × SCOPE × PATH-TO-STAR. Slight sector moves that raise scope and advance the star are first-class wins.

THE THREE PILLARS (score each 0-100 from the full profile + posting — pure judgment, no keyword rules):

1) CONTRIBUTION — Can they DO the core deliverables of this role within ~90 days (including while ramping on learn_on_job tools)?
   Score what they can deliver soon on the SAME craft — not what they might become in a different profession.
   High = meaningful impact within months; low = wrong craft or years of catch-up.
   If coreCraftFit=not_eligible, contributionScore MUST be ≤45.
   If coreCraftFit=day_one or with_ramp, contribution can still be high (60–90) even with tool gaps.

2) LEARNING — Does this raise their ceiling toward the north star over time?
   New scope, harder problems, leadership, tools they'll ramp on — raise learningScore when learn_on_job gaps exist or coreCraftFit=with_ramp.
   learningScore MUST NOT inflate eligibility when coreCraftFit=not_eligible.
   A training budget does NOT turn a specialty lead role into a fit if they must already lead that specialty.

3) MONEY — Compensation quality vs level and prefs.
   Use disclosed pay when present; otherwise infer plausibly and note uncertainty.

SCOPE INCREASE (0-100) — fourth signal, explicit:
- Bigger ownership: team, budget, stakeholders, decision rights, market, IC→lead.
- Rank "same title, bigger scope" and "adjacent title, broader ownership" ABOVE lateral clones.
- Low score for title synonyms with identical scope.

OVERALL fitScore (0-100):
- contributionScore is the primary driver — fitScore should rarely exceed contributionScore + 15.
- learningScore and scopeIncrease are tiebreakers only when contribution is credible (≥55).
- Prefer destination/step/stretch over lateral ONLY when contribution is credible; regressive → fitScore ≤35.
- Mild seniority stretch (+1) is welcome when contribution stays credible and it advances the star.
- If core deliverables are unmet, fitScore MUST be ≤50 regardless of learning/money/scope.

TARGET SENIORITY BASELINE: ${seniorityLabel(targetLevel)} (stretch up is encouraged when earned by the profile and aligned with the star).

${preferenceBlock}

${targetRolesScoring}

${languageBlock}

${commuteBlock}

${pathScoringBlock}

preferencesMatch: soft true/false vs stated prefs (informational only — never veto an ideal path move toward the star).
languageRequirementMet: HARD gate — false means this job must not be shown to the candidate.
commuteRequirementMet: HARD gate when max commute minutes is set (including home-base only = 0). Home-base only → true only if job is in home-base city; false for other cities and remote. Max > 0 → false when commute exceeds limit; true when remote or within limit.
feedbackRequirementMet: HARD gate when USER-TAUGHT SEARCH CONSTRAINTS appear in the candidate block — false when this job clearly violates those learned lessons (e.g. user said roles like this are too senior). When uncertain, true. When no taught constraints, true.

CORE CRAFT FIT — PRIMARY ELIGIBILITY (AI judgment, not keyword matching):

Decide ONE of:
- "day_one": Same craft; they can deliver core duties immediately with existing evidence.
- "with_ramp": Same craft; they can deliver core duties within ~90 days while learning tools/systems/processes on the job. KEEP the job.
- "not_eligible": Wrong craft, or a true day-1 blocker (specialty they never practiced, essential license/credential, OR multi-year specialty experience the posting treats as required with no equivalent evidence). HIDE unless this is an enabled dream/target and stretch is allowed (then pathType=stretch with honest gaps — discovery may show as stretch).

HARD vs SOFT vs LEARNABLE (judge each gap — this drives show/hide):
1) HARD / must_have → coreCraftFit=not_eligible (HIDE unless dream-stretch exception above):
   - Posting requires N years in a named specialty that IS the job and the CV shows no comparable specialty years — leadership in a different craft does NOT substitute.
   - Essential license, degree, registration, or regulated credential missing.
   - Core deliverables are a specialty the candidate has never practiced.
2) LEARNABLE / learn_on_job → coreCraftFit=with_ramp (SHOW):
   - Tools, frameworks, methodologies, agile practices, a specific stack — when the underlying craft/leadership already matches.
   - Mild step-up in team size or stakeholder complexity on the SAME craft.
3) SOFT / nice_to_have → does not hide:
   - Explicitly "nice to have", "plus", "preferred", "voordeel", "pre" in the posting.
   - Adjacent experience that would help but is not required to do the job.

Consistency rules (critical):
- If you would write that they "possess the core operational/leadership skills" or "could do this job with ramp" → coreCraftFit MUST be day_one or with_ramp — NEVER not_eligible.
- Missing tools/systems (WMS, Excel, reporting screens, a specific ERP module used as a warehouse tool) while the craft is floor ops / supervision / inventory → almost always with_ramp, NOT not_eligible.
- Specialty craft that IS the job (platform/digital product leadership, S&OP / demand planning lead, ERP implementation lead, international transport network design) with no CV evidence → not_eligible.
- "Manager" titles: match the OBJECT of management. Managing NGO projects/volunteers ≠ managing digital platforms/product-tech. Preferential sector fit (charity/NGO) does NOT override a specialty years gap.
- Posting says "we train" / "nice to have" / junior on a tool → with_ramp or day_one.
- Mild team-size step-up on the same craft → with_ramp (or day_one), not not_eligible.
- skillRequirementMet MUST equal (coreCraftFit !== "not_eligible").
- NEVER put a multi-year specialty requirement the candidate lacks into nice_to_have just to keep a high fitScore — if it is required for the role, it is must_have + not_eligible.

For EVERY material gap, classify learnability (for UI + learningScore):
- "must_have": Only when coreCraftFit=not_eligible for that gap (true day-1 blocker).
- "learn_on_job": Expected ramp while doing core work. Use this when coreCraftFit=with_ramp.
- "nice_to_have": Preference / plus only — posting marks it soft OR it is truly optional.

Judgment examples (teach the distinction — do not pattern-match keywords):
- Warehouse Supervisor / Teamleider: core = floor leadership + inventory ops; advanced WMS mentioned → coreCraftFit=with_ramp, WMS=learn_on_job. KEEP.
- Same title but hire must LEAD a greenfield SAP/WMS program as the main job with no ops leadership overlap → coreCraftFit=not_eligible.
- Supply chain / S&OP / demand planning where those ARE the job and CV is hands-on warehouse only → not_eligible.
- Manager Platform / digital transformation requiring 8–10 years platform or digital transformation experience; CV is NGO project leadership without platform/digital craft → not_eligible, years gap=must_have. KEEP ONLY if CV shows comparable platform/digital ownership years.
- Lean Portfolio Management or agile transition listed alongside a platform role they otherwise qualify for → learn_on_job.
- Posting says planning/ERP "nice to have" or "we train" → with_ramp or day_one.

missingSkills rules:
- List every material gap with learnability on EACH entry.
- isHardRequirement must equal (learnability === "must_have").
- If coreCraftFit=not_eligible, ≥1 entry MUST be learnability="must_have".
- If coreCraftFit=day_one or with_ramp, NO entry may be learnability="must_have" (use learn_on_job / nice_to_have).
- skillNotes: 1 sentence matching coreCraftFit (never say "can do the job" while setting not_eligible).
- Do NOT bury required years-in-specialty as nice_to_have.

employerType: short label from the posting.

Return ONLY valid JSON:
{
  "fitScore": 0-100,
  "contributionScore": 0-100,
  "learningScore": 0-100,
  "moneyScore": 0-100,
  "scopeIncrease": 0-100,
  "strengths": ["string"],
  "missingSkills": [{ "skill": "string", "learnability": "must_have" | "learn_on_job" | "nice_to_have", "isHardRequirement": true/false }],
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
  "commuteRequirementMet": true/false,
  "commuteNotes": "1 sentence on commute eligibility",
  "estimatedCommuteMinutes": number or omit,
  "coreCraftFit": "day_one" | "with_ramp" | "not_eligible",
  "skillRequirementMet": true/false,
  "skillNotes": "1 sentence on skill/credential eligibility",
  "feedbackRequirementMet": true/false,
  "feedbackNotes": "1 sentence if taught constraints apply",
  "pathType": "step" | "stretch" | "destination" | "lateral" | "regressive",
  "ladderPath": "Step toward [north star] via …",
  "matchedDestination": "north-star or ladder title or omit",
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
  if (s === "regressive" || s === "regression" || s === "off_path" || s === "cliff")
    return "regressive";
  return "step";
}

/** Mildly prefer scope climbs over lateral clones after AI scoring — only when contribution is credible. */
function applyLadderFitBias(
  fitScore: number,
  scopeIncrease: number,
  pathType: JobPathType,
  contributionScore: number
): number {
  if (pathType === "regressive") return Math.min(clampScore(fitScore), 35);
  if (contributionScore < 55) return clampScore(fitScore);
  let score = fitScore;
  if (pathType === "lateral" && scopeIncrease < 40) {
    score = Math.round(score * 0.85);
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
  hasPrefs: boolean,
  commute: {
    commuteRequirementMet: boolean;
    commuteNotes: string;
    estimatedCommuteMinutes?: number;
  }
): JobMatchResult {
  const scopeIncrease = clampScore(result.scopeIncrease, 40);
  const pathType = coercePathType(result.pathType);
  const contributionScore = clampScore(result.contributionScore);
  const fitScore = applyLadderFitBias(
    clampScore(result.fitScore),
    scopeIncrease,
    pathType,
    contributionScore
  );

  let missingSkills = Array.isArray(result.missingSkills)
    ? result.missingSkills
        .map((s) =>
          toMissingSkill({
            skill: String(s.skill ?? ""),
            learnability: (s as { learnability?: GapLearnability }).learnability,
            isHardRequirement: Boolean(
              (s as { isHardRequirement?: boolean }).isHardRequirement
            ),
          })
        )
        .filter((s): s is NonNullable<typeof s> => !!s)
    : [];

  // Primary gate: AI coreCraftFit. Align skillRequirementMet + gap labels with it.
  let coreCraftFit: CoreCraftFit =
    normalizeCoreCraftFit(result.coreCraftFit) ??
    (result.skillRequirementMet === false ||
    hasUnmetHardRequirements(missingSkills)
      ? "not_eligible"
      : missingSkills.some((s) => s.learnability === "learn_on_job")
        ? "with_ramp"
        : "day_one");

  // Years / specialty / credential gaps cannot be soft-ramped or buried as nice-to-have.
  const nonLearnableGaps = missingSkills.filter((s) =>
    looksLikeNonLearnableGap(s.skill)
  );
  if (nonLearnableGaps.length > 0) {
    missingSkills = missingSkills.map((s) =>
      looksLikeNonLearnableGap(s.skill)
        ? {
            ...s,
            learnability: "must_have" as const,
            isHardRequirement: true,
          }
        : s
    );
    coreCraftFit = "not_eligible";
  } else if (coreCraftFit === "day_one" || coreCraftFit === "with_ramp") {
    // Same craft — demote only tool/process must_haves the model over-labeled.
    missingSkills = missingSkills.map((s) => {
      if (s.learnability !== "must_have") return s;
      if (looksLikeRampableToolGap(s.skill)) {
        return {
          ...s,
          learnability: "learn_on_job" as const,
          isHardRequirement: false,
        };
      }
      // Non-tool must_have contradicts day_one/with_ramp — treat as blocker.
      return s;
    });
    if (missingSkills.some((s) => s.learnability === "must_have")) {
      coreCraftFit = "not_eligible";
    }
  }

  const skillRequirementMet = coreCraftFit !== "not_eligible";

  const learnOnJobCount = missingSkills.filter(
    (s) => s.learnability === "learn_on_job"
  ).length;

  let contributionOut = contributionScore;
  if (!skillRequirementMet) {
    contributionOut = Math.min(contributionOut, 45);
  }

  let learningOut = clampScore(result.learningScore);
  if (
    skillRequirementMet &&
    (learnOnJobCount > 0 || coreCraftFit === "with_ramp")
  ) {
    learningOut = Math.max(
      learningOut,
      Math.min(100, 55 + Math.max(learnOnJobCount, 1) * 8)
    );
  }

  let fitOut = fitScore;
  // Contribution is primary — learning/scope cannot inflate far above ability to deliver.
  fitOut = Math.min(fitOut, contributionOut + 15);
  if (!skillRequirementMet) {
    fitOut = Math.min(fitOut, 40);
  }
  if (!commute.commuteRequirementMet) {
    fitOut = Math.min(fitOut, 35);
  }

  let feedbackRequirementMet =
    typeof result.feedbackRequirementMet === "boolean"
      ? result.feedbackRequirementMet
      : true;
  const feedbackNotes = result.feedbackNotes?.trim() || "";
  if (!feedbackRequirementMet) {
    fitOut = Math.min(fitOut, 35);
  }

  const applyRecommendation =
    Boolean(result.applyRecommendation) &&
    skillRequirementMet &&
    commute.commuteRequirementMet &&
    feedbackRequirementMet &&
    !isSkillIneligible({ skillRequirementMet, coreCraftFit, missingSkills }) &&
    fitOut >= 50 &&
    pathType !== "lateral" &&
    pathType !== "regressive";

  return {
    ...result,
    fitScore: fitOut,
    contributionScore: contributionOut,
    learningScore: learningOut,
    moneyScore: clampScore(result.moneyScore, 50),
    scopeIncrease,
    strengths: Array.isArray(result.strengths) ? result.strengths : [],
    missingSkills: missingSkills.map((s) => ({
      skill: s.skill,
      learnability:
        s.learnability ??
        (s.isHardRequirement ? ("must_have" as const) : ("nice_to_have" as const)),
      isHardRequirement: s.isHardRequirement,
    })),
    applyRecommendation,
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
    coreCraftFit,
    skillRequirementMet,
    skillNotes: result.skillNotes?.trim() || "",
    commuteRequirementMet: commute.commuteRequirementMet,
    commuteNotes: commute.commuteNotes,
    estimatedCommuteMinutes: commute.estimatedCommuteMinutes,
    feedbackRequirementMet,
    feedbackNotes,
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
  const commute = await screenCommute({
    profile: context.profile,
    jobLocation: listing.location,
    postingText,
    aiCommuteRequirementMet: result.commuteRequirementMet,
    aiEstimatedCommuteMinutes: result.estimatedCommuteMinutes,
    aiCommuteNotes: result.commuteNotes,
  });
  return normalizeMatchResult(result, hasPrefs, commute);
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
  const commute = await screenCommute({
    profile: context.profile,
    jobLocation: job.location,
    postingText: `${job.description}\n${[...(job.requirements?.required ?? []), ...(job.requirements?.preferred ?? [])].map((r) => r.skill).join("\n")}`,
    aiCommuteRequirementMet: result.commuteRequirementMet,
    aiEstimatedCommuteMinutes: result.estimatedCommuteMinutes,
    aiCommuteNotes: result.commuteNotes,
  });
  return normalizeMatchResult(result, hasPrefs, commute);
}
