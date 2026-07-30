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
- Only use information present in the provided data
- Treat LinkedIn experience and skills as first-class evidence alongside the resume

EXPERIENCE LEVEL (judgment from evidence, not title inflation):
- Reflect years of ownership, team leadership, budget/P&L, and proven scope — not aspirational titles
- Recent promotion into first supervisory role after years as hands-on IC → typically mid (or mid leaning senior), NOT staff/principal, and usually NOT full senior unless there is sustained multi-year supervisory/manager evidence
- "senior" needs clear evidence of broader ownership over time (larger teams, multiple areas, budget, or multi-year lead experience) — a new Magazijnchef / team lead title alone after IC years is usually mid

INFERRED ROLES (hireability, not wish list):
- List roles an employer would realistically interview them for NOW based on demonstrated craft
- High confidence (≥80) only when they have done substantially similar work
- Do NOT invent specialty titles from a different profession unless the CV shows that craft
- Adjacent is OK when transferable day-to-day work overlaps; adjacent is NOT "jump into a different profession because it sounds like growth"

CAREER LADDER (required — this drives job search keywords):
Build an honest climb map. Prefer scope step-ups they can actually perform soon.
- currentRole: present / most recent role
- nextRoles (2–4, ~0–18 months): roles they could be hired for with current evidence + mild stretch. If gapsToClose would block day-1 delivery of the role's CORE craft (not merely a learnable tool), that title does NOT belong in nextRoles — put it later or drop it
- stretchRoles (1–3, ~1–2 years): bigger scope that still sits on the SAME craft ladder. Stretch is "bigger version of what they do", not "new profession that needs a specialty craft they never practiced"
- Tools/systems they can ramp on while doing the same craft may appear in gapsToClose — that is fine for nextRoles. Unsupported specialty crafts must not.
- For EVERY ladder role: transferableStrengths, gapsToClose, whyScopeIncreases (team/stakeholders/decision rights — not a fancier title alone), searchQuery (2–5 words boards understand; Dutch phrases when the resume is Dutch)
- searchQuery MUST be a title an employer would hire THEM for with current evidence (or mild stretch). One short phrase preferred — avoid stuffing unrelated specialties into searchQuery
- Prefer same-branch bigger scope first; adjacent only when day-to-day duties clearly transfer
- Do NOT require a fixed quota of adjacent roles if adjacent would invent unsupported specialty careers
- Summary must acknowledge what they cannot yet lead without pretending those are near-term destinations

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
