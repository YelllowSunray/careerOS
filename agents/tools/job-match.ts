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
  strengths: z.array(z.string()),
  missingSkills: z.array(
    z.object({
      skill: z.string(),
      isHardRequirement: z.boolean(),
    })
  ),
  applyRecommendation: z.boolean(),
  reasoning: z.string(),
  preferenceAlignment: z.string(),
  preferencesMatch: z.boolean(),
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
  const targetLevel = inferExperienceLevelFromContext(context);

  const preferenceBlock = jobPrefs
    ? `
CANDIDATE JOB PREFERENCES (free text — interpret as HARD CONSTRAINTS for THIS candidate only):
"""
${jobPrefs}
"""

PREFERENCE ENFORCEMENT (AI-interpreted from the text above — do not invent constraints they did not state):
1. Classify the employer from company name + posting into a short employerType label
   (examples of labels: ngo_charity, non_profit, government, municipality, province,
   commercial, consultancy, housing_corporation, education, healthcare_provider, other).
2. Decide preferencesMatch by comparing THAT classification to what THIS candidate asked for.
3. If preferences name an org/sector type (NGO, charity, startup, fintech, etc.):
   - preferencesMatch=true ONLY when the employer clearly fits that type.
   - Adjacent "social impact" work at a different org type does NOT satisfy an org-type preference.
   - Example interpretation only (apply the same logic to whatever THEY wrote):
     if they asked for charities/NGOs, then gemeente/provincie/government, commercial firms,
     woningcorporaties, and for-profit consultancies → preferencesMatch=false.
4. Also enforce hours, salary, remote/onsite, location if they stated them.
5. If the posting is too thin to verify a stated preference (especially org type), preferencesMatch=false.
6. When preferencesMatch=false: fitScore MUST be ≤40 and applyRecommendation=false.
   Skills overlap NEVER overrides a preference conflict.`
    : `
No free-text job preferences on file.
Work preference: ${workPref}
Preferred locations: ${countries}
Set preferencesMatch=true and preferenceAlignment="No specific job preferences stated."`;

  return `You are an expert career matcher finding IDEAL fits between a candidate and a job.

Read the candidate's FULL resume, LinkedIn profile, and portfolio.
Read the FULL job posting — title, company/employer type, requirements, seniority, employment type, location/remote.

TARGET SENIORITY: ${seniorityLabel(targetLevel)} — penalize roles clearly above or below this level.
${preferenceBlock}

Score holistically:
- Skills/experience fit from resume + LinkedIn + portfolio
- Seniority appropriateness
- Preference compliance (hard when preferences exist)

fitScore is 0-100 (≤40 = preference conflict or poor fit, 70+ = good, 85+ = strong)

Return ONLY valid JSON with this exact shape:
{
  "fitScore": 0-100,
  "strengths": ["string"],
  "missingSkills": [{ "skill": "string", "isHardRequirement": true/false }],
  "applyRecommendation": true/false,
  "reasoning": "2-4 sentences on skills/experience fit",
  "preferenceAlignment": "1-2 sentences naming employer type vs stated preferences",
  "preferencesMatch": true/false,
  "employerType": "short label"
}

CANDIDATE (resume + LinkedIn + portfolio + profile):
${candidateBlock}

JOB:
${jobBlock}`;
}

function enforcePreferenceHardCap(
  result: JobMatchResult,
  hasPrefs: boolean
): JobMatchResult {
  if (!hasPrefs) {
    return {
      ...result,
      preferencesMatch: result.preferencesMatch ?? true,
      preferenceAlignment:
        result.preferenceAlignment || "No specific job preferences stated.",
    };
  }
  if (result.preferencesMatch !== true) {
    return {
      ...result,
      preferencesMatch: false,
      fitScore: Math.min(result.fitScore, 40),
      applyRecommendation: false,
      preferenceAlignment:
        result.preferenceAlignment ||
        "Could not confirm the employer matches stated job preferences.",
    };
  }
  return result;
}

/** Deep AI match: full resume + LinkedIn + portfolio vs full job posting text. */
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
  return enforcePreferenceHardCap(result, hasPrefs);
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
  return enforcePreferenceHardCap(result, hasPrefs);
}
