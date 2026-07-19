import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import {
  normalizeResumeExtraction,
  normalizeCandidateSynthesis,
} from "@/lib/gemini/coerce";

const stringArray = z.array(z.string());

const ladderRoleSchema = z.object({
  title: z.string(),
  horizon: z.enum(["next", "stretch"]),
  branch: z.enum(["same", "adjacent"]),
  transferableStrengths: stringArray,
  gapsToClose: stringArray,
  whyScopeIncreases: z.string(),
  searchQuery: z.string().optional(),
});

export const resumeExtractionSchema = z.preprocess(
  normalizeResumeExtraction,
  z.object({
    phoneNumber: z.string().optional(),
    skills: stringArray,
    experience: z.array(
      z.object({
        title: z.string(),
        company: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        description: z.string(),
        technologies: stringArray,
      })
    ),
    projects: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        technologies: stringArray,
      })
    ),
    technologies: stringArray,
    education: z.array(
      z.object({
        institution: z.string(),
        degree: z.string(),
        field: z.string().optional(),
        graduationYear: z.string().optional(),
      })
    ),
    certifications: z.array(
      z.object({
        name: z.string(),
        issuer: z.string().optional(),
        year: z.string().optional(),
      })
    ),
  })
);

export type ExtractedResume = z.infer<typeof resumeExtractionSchema>;

const CANDIDATE_JSON_SHAPE = `{
  "skills": ["string"],
  "technologies": ["string"],
  "projects": [{ "name": "string", "description": "string", "technologies": ["string"], "links": ["string"], "source": "resume" | "portfolio" | "linkedin" }],
  "inferredRoles": [{ "role": "string", "confidence": 85 }],
  "experienceLevel": "mid",
  "strengths": ["string"],
  "gaps": ["string"],
  "careerLadder": {
    "currentRole": "string",
    "summary": "1-2 sentence climb strategy",
    "nextRoles": [{
      "title": "string",
      "horizon": "next",
      "branch": "same" | "adjacent",
      "transferableStrengths": ["string"],
      "gapsToClose": ["string"],
      "whyScopeIncreases": "string",
      "searchQuery": "2-5 word board search phrase"
    }],
    "stretchRoles": [{
      "title": "string",
      "horizon": "stretch",
      "branch": "same" | "adjacent",
      "transferableStrengths": ["string"],
      "gapsToClose": ["string"],
      "whyScopeIncreases": "string",
      "searchQuery": "2-5 word board search phrase"
    }]
  }
}`;

export async function extractResumeData(
  text: string,
  userId?: string
): Promise<ExtractedResume> {
  return generateStructured(
    `You are an expert resume parser. Extract ALL structured data from this resume using only what is present in the text.
Do not invent information. Extract phone number if present (any format). Separate skills from technologies where possible.
Return JSON with skills and technologies as arrays of strings.

RESUME:
${text.slice(0, 28000)}`,
    resumeExtractionSchema,
    { userId, operation: "resume_extraction" }
  );
}

export const candidateSynthesisSchema = z.preprocess(
  normalizeCandidateSynthesis,
  z.object({
    skills: stringArray,
    technologies: stringArray,
    projects: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        technologies: stringArray,
        links: stringArray,
        source: z.enum(["resume", "portfolio", "linkedin"]),
      })
    ),
    inferredRoles: z.array(
      z.object({
        role: z.string(),
        confidence: z.number(),
      })
    ),
    strengths: stringArray,
    gaps: stringArray,
    experienceLevel: z.enum(["junior", "mid", "senior", "staff", "principal"]),
    careerLadder: z
      .object({
        currentRole: z.string(),
        summary: z.string(),
        nextRoles: z.array(ladderRoleSchema).min(1).max(4),
        stretchRoles: z.array(ladderRoleSchema).max(3),
      })
      .optional(),
  })
);

export type SynthesizedCandidate = z.infer<typeof candidateSynthesisSchema>;

export async function synthesizeCandidateProfile(
  input: {
    resumeJson: string;
    portfolioContent: string;
    linkedInContent?: string;
  },
  userId?: string
): Promise<SynthesizedCandidate> {
  return generateStructured(
    `Build a candidate knowledge graph by merging resume data, LinkedIn profile, and portfolio website content.
Rules:
- skills, technologies, strengths, gaps, inferredRoles must be JSON arrays (never objects)
- Each project must include links (array, use [] if none) and source ("resume", "portfolio", or "linkedin")
- experienceLevel must be one of: junior, mid, senior, staff, principal
- Deduplicate skills, technologies, and projects across sources
- Infer suitable job roles with confidence 0-100
- Only use information present in the provided data
- Treat LinkedIn experience and skills as first-class evidence alongside the resume

CAREER LADDER (required — this drives job search):
Build an explicit climb map. Do NOT only list title synonyms of their current job.
- currentRole: their present / most recent role
- nextRoles: 2–4 plausible NEXT roles (~0–18 months). Mix same-branch step-ups AND adjacent sector/function moves (e.g. Compliance → Risk, AML, Privacy, Regulatory Affairs) when transferable strengths support it
- stretchRoles: 1–3 roles ~1–2 years out that increase scope further
- For EVERY ladder role include: transferableStrengths (already have), gapsToClose, whyScopeIncreases (team/stakeholders/decision rights/market/IC→lead — not just a fancier title), searchQuery (2–5 words boards understand)
- Prefer scope increases and slight sector moves that compound into bigger jumps later
- At least TWO nextRoles or stretchRoles should be branch="adjacent" when credible

Return JSON matching this exact shape:
${CANDIDATE_JSON_SHAPE}

RESUME DATA:
${input.resumeJson.slice(0, 12000)}

LINKEDIN PROFILE:
${(input.linkedInContent ?? "").slice(0, 12000) || "No LinkedIn profile content available."}

PORTFOLIO WEBSITE CONTENT:
${input.portfolioContent.slice(0, 12000) || "No portfolio content available."}`,
    candidateSynthesisSchema,
    { userId, operation: "candidate_synthesis" }
  );
}
