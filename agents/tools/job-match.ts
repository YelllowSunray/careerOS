import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeJobMatch } from "@/lib/gemini/coerce";
import { formatContextForPrompt } from "@/lib/candidate/context";
import { getPrimaryCountry } from "@/lib/job-search/countries";
import { inferExperienceLevelFromContext, seniorityLabel } from "@/lib/job-search/tailored-queries";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Job } from "@/lib/types";

const matchSchema = z.preprocess(
  (raw) => normalizeJobMatch(raw),
  z.object({
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
    preferenceAlignment: z.string().optional(),
    preferencesMatch: z.boolean().optional(),
  })
);

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
CANDIDATE JOB PREFERENCES (must factor into fitScore and preferenceAlignment):
${jobPrefs}
- Heavily penalize fitScore when the role clearly conflicts (e.g. part-time when they want full-time, on-site when they want remote, wrong country)
- Note specific alignments and mismatches in preferenceAlignment`
    : `
Work preference: ${workPref}
Preferred locations: ${countries}`;

  return `You are an expert career matcher finding IDEAL fits between a candidate and a job.

Read the candidate's FULL resume, LinkedIn profile, and portfolio — projects, employers, technologies, trajectory, and experience level.
Read the FULL job posting — title, requirements, responsibilities, seniority, employment type, and location/remote policy.

TARGET SENIORITY: ${seniorityLabel(targetLevel)} — penalize roles clearly above or below this level.
${preferenceBlock}

Score holistically — NOT keyword matching alone:
- Does their real experience (resume + LinkedIn + portfolio) align with what this role needs?
- Is the seniority level appropriate (not too junior, not unrealistic reach)?
- Would their portfolio / LinkedIn work history convince this employer?
- Are hard requirements met by evidence in resume, LinkedIn, or portfolio?
- Does the role match their stated job preferences (employment type, remote/onsite, location, industry)?
- Nice-to-have gaps should NOT heavily penalize the score

fitScore is 0-100 (below 50 = poor match, 70+ = good match, 85+ = strong match)

Return ONLY valid JSON with this exact shape:
{
  "fitScore": 0-100,
  "strengths": ["string array of match strengths"],
  "missingSkills": [{ "skill": "string", "isHardRequirement": true/false }],
  "applyRecommendation": true/false,
  "reasoning": "2-4 sentence summary of skills/experience fit (cite LinkedIn when it supplies evidence)",
  "preferenceAlignment": "1-2 sentences on how this job matches or conflicts with their stated job preferences",
  "preferencesMatch": true/false
}

CANDIDATE (resume + LinkedIn + portfolio + profile):
${candidateBlock}

JOB:
${jobBlock}`;
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
  const jobBlock = `Title: ${listing.title}
Company: ${listing.company}
Location: ${listing.location ?? "unknown"}
URL: ${listing.url}

FULL JOB POSTING:
${postingText.slice(0, 14000)}`;

  return generateStructured(
    buildHolisticMatchPrompt(context, jobBlock),
    matchSchema,
    { userId: context.userId, operation: "listing_match" }
  );
}

export async function matchJobToCandidate(job: Job, context: CandidateContext) {
  const jobBlock = JSON.stringify({
    title: job.title,
    company: job.company,
    requirements: job.requirements,
    description: job.description.slice(0, 8000),
    location: job.location,
  });

  return generateStructured(
    buildHolisticMatchPrompt(context, jobBlock),
    matchSchema,
    { userId: context.userId, operation: "job_match" }
  );
}
