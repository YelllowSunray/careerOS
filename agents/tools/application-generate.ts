import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeApplicationMaterials } from "@/lib/gemini/coerce";
import { formatContextForPrompt } from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { Job, JobMatch, CoverLetterLanguage, JobBoard, CoverLetterSources } from "@/lib/types";
import type { DiscoveredJobListing } from "@/agents/tools/job-discovery";
import { parseJobPosting } from "@/agents/tools/job-discovery";
import {
  createListingBrowser,
  fetchListingContent,
  prioritizeListingBrief,
} from "@/agents/tools/listing-fetch";

export type { CoverLetterLanguage };

const materialsSchema = z.preprocess(
  (raw) => normalizeApplicationMaterials(raw),
  z.object({
    coverLetter: z.string(),
    resumeSummary: z.string(),
    customAnswers: z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
      })
    ),
  })
);

/** Force requirement→evidence mapping before the letter so it stays listing-driven. */
const coverLetterSchema = z.object({
  requirementMatches: z
    .array(
      z.object({
        requirement: z.string(),
        candidateEvidence: z.string(),
        matched: z.boolean(),
      })
    )
    .min(1),
  coverLetter: z.string().min(120),
});

const COMMON_QUESTIONS = [
  "Why do you want this role?",
  "Why do you want to work at this company?",
  "Why are you a good fit for this position?",
  "What interests you about this role?",
  "Tell us about a project you are proud of.",
  "Describe your experience with the primary technologies for this role.",
];

function jobRequirementsBlock(job: Job): string {
  const required =
    job.requirements?.required
      ?.map((r) => (r.description ? `${r.skill}: ${r.description}` : r.skill))
      .filter(Boolean) ?? [];
  const preferred =
    job.requirements?.preferred
      ?.map((r) => (r.description ? `${r.skill}: ${r.description}` : r.skill))
      .filter(Boolean) ?? [];
  const skills = job.extractedSkills ?? [];
  return [
    required.length ? `Hard requirements:\n${required.map((r) => `- ${r}`).join("\n")}` : "",
    preferred.length ? `Preferred:\n${preferred.map((r) => `- ${r}`).join("\n")}` : "",
    skills.length ? `Skills mentioned in listing: ${skills.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatJobRequirementsForDisplay(job: Job): string {
  return jobRequirementsBlock(job);
}

function languageInstructions(language: CoverLetterLanguage): string {
  if (language === "nl") {
    return `LANGUAGE: Write the ENTIRE coverLetter in Dutch (Nederlands). Use natural professional Dutch — not a literal translation of English boilerplate. requirementMatches may stay in English.`;
  }
  return `LANGUAGE: Write the ENTIRE coverLetter in English.`;
}

/** Compact candidate block so the job listing is not drowned out. */
function formatCandidateForCoverLetter(
  context: CandidateContext,
  maxChars = 10000
): string {
  const parts: string[] = [
    `Name: ${context.profile.name}`,
    "",
    "=== RESUME / CV (evidence only) ===",
    context.resumeRawText || "(no resume text)",
    "",
    "=== LINKEDIN PROFILE (evidence only) ===",
    context.linkedInRawText || "(no LinkedIn profile)",
    "",
    "=== PORTFOLIO / WEBSITES (evidence only) ===",
    context.portfolioRawText || "(no portfolio content)",
  ];

  if (context.coverLetterSamplesText.trim()) {
    parts.push(
      "",
      "=== COVER LETTER SAMPLES (voice/structure only — do not copy) ===",
      context.coverLetterSamplesText
    );
  }

  if (context.structuredProfile) {
    parts.push(
      "",
      "=== SKILLS / TECH SUMMARY ===",
      `Skills: ${(context.structuredProfile.skills ?? []).join(", ")}`,
      `Technologies: ${(context.structuredProfile.technologies ?? []).join(", ")}`
    );
  }

  return parts.filter(Boolean).join("\n").slice(0, maxChars);
}

function toListing(job: Job): DiscoveredJobListing {
  const platform = (job.sourcePlatform ?? "linkedin") as JobBoard | "playwright" | "career_page";
  return {
    title: job.title,
    company: job.company,
    url: job.applicationUrl,
    location: job.location,
    platform,
  };
}

/**
 * Re-fetch the live Indeed/LinkedIn (etc.) posting so the letter uses current listing text,
 * not only a short stored summary.
 */
export async function refreshJobListingForCoverLetter(job: Job): Promise<{
  listingText: string;
  job: Job;
}> {
  let listingText = "";
  let browser = null;
  const needsBrowser =
    job.sourcePlatform === "indeed" ||
    job.sourcePlatform === "linkedin" ||
    /linkedin\.com/i.test(job.applicationUrl);

  try {
    if (needsBrowser) {
      try {
        browser = await createListingBrowser();
      } catch (e) {
        console.warn("[Cover letter] Listing browser launch failed:", e);
      }
    }

    listingText = await fetchListingContent(toListing(job), browser);
    listingText = prioritizeListingBrief(listingText, 16000);
  } catch (e) {
    console.warn(
      "[Cover letter] Live listing fetch failed, using stored job description:",
      e instanceof Error ? e.message : e
    );
    listingText = prioritizeListingBrief(
      [
        `Title: ${job.title}`,
        `Company: ${job.company}`,
        `Location: ${job.location}`,
        `URL: ${job.applicationUrl}`,
        "",
        "JOB POSTING:",
        job.description,
      ].join("\n"),
      16000
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const storedRequirementsEmpty =
    (job.requirements?.required?.length ?? 0) === 0 &&
    (job.requirements?.preferred?.length ?? 0) === 0;
  const storedDescriptionThin = (job.description?.trim().length ?? 0) < 800;
  const liveIsRicher =
    listingText.trim().length > (job.description?.trim().length ?? 0) + 200;

  let enriched = job;

  // Always re-parse LinkedIn/Indeed briefs when we have live text so requirements
  // reflect the full expanded job description, not a short discovery summary.
  const shouldReparse =
    liveIsRicher ||
    storedRequirementsEmpty ||
    storedDescriptionThin ||
    needsBrowser;

  if (shouldReparse && listingText.trim().length > 300) {
    try {
      const parsed = await parseJobPosting(
        listingText,
        job.applicationUrl,
        job.userId,
        "cover_letter_job_parse"
      );
      enriched = {
        ...job,
        title: parsed.title || job.title,
        company: parsed.company || job.company,
        location: parsed.location || job.location,
        description:
          parsed.description?.trim().length > 400
            ? parsed.description
            : job.description || parsed.description,
        requirements:
          (parsed.requirements?.required?.length ?? 0) > 0 ||
          (parsed.requirements?.preferred?.length ?? 0) > 0
            ? parsed.requirements
            : job.requirements,
        extractedSkills:
          parsed.extractedSkills?.length > 0
            ? parsed.extractedSkills
            : job.extractedSkills,
        remoteType: parsed.remoteType ?? job.remoteType,
      };
      console.log(
        `[Cover letter] Re-parsed listing: ${enriched.requirements?.required?.length ?? 0} required, ${enriched.requirements?.preferred?.length ?? 0} preferred, description ${enriched.description.length} chars`
      );
    } catch (e) {
      console.warn("[Cover letter] Re-parse of live listing failed:", e);
      if (liveIsRicher) {
        enriched = {
          ...job,
          description: listingText.slice(0, 12000),
        };
      }
    }
  }

  return { listingText, job: enriched };
}

/**
 * Generate a cover letter driven by the job listing requirements,
 * using CV / websites / sample letters only as evidence.
 */
export async function generateCoverLetterForJob(
  job: Job,
  context: CandidateContext,
  match: JobMatch | null,
  language: CoverLetterLanguage = "en",
  listingText?: string
) {
  const candidateBlock = formatCandidateForCoverLetter(context, 10000);
  const requirements = jobRequirementsBlock(job);
  const strengths = match?.strengths?.length
    ? match.strengths.join(", ")
    : "(infer matches from listing + candidate evidence)";
  const missing = match?.missingSkills?.length
    ? match.missingSkills
        .map((s) => `${s.skill}${s.isHardRequirement ? " (required)" : ""}`)
        .join(", ")
    : "(none listed)";
  const matchReasoning = match?.reasoning?.trim() || "(no prior match analysis)";

  const postingBody = prioritizeListingBrief(
    listingText?.trim() || job.description || "",
    16000
  );
  const structuredRequirements = requirements || "(none structured — model must extract from posting text)";

  console.log(
    `[Cover letter] Job brief for ${job.title} @ ${job.company}: ${postingBody.length} chars from ${job.applicationUrl}`
  );
  if (postingBody.length < 800) {
    console.warn(
      `[Cover letter] Thin job brief (${postingBody.length} chars) — letter may miss listing requirements`
    );
  }

  const result = await generateStructured(
    `You write job-specific cover letters. The JOB LISTING / BRIEF is the primary driver.
The candidate resume/portfolio are ONLY evidence to prove fit for what THIS listing asks for.

${languageInstructions(language)}

WORKFLOW (follow exactly):
1. Read the FULL job brief below carefully — especially Requirements, Qualifications, Responsibilities, "What you'll need", "Who you are", and similar sections.
2. Extract EVERY concrete requirement from the brief (skills, technologies, years of experience, domain knowledge, soft skills, education, languages, tools). Do not skip items just because the structured list is shorter than the brief.
3. For each important requirement, fill requirementMatches (aim for 8–15 items when the brief has that many):
   - requirement: quote or closely paraphrase the listing's own wording
   - matched: true only if the resume/portfolio clearly supports it
   - candidateEvidence: short proof FROM the resume/portfolio (or why not matched)
4. Write coverLetter that is ABOUT THIS JOB BRIEF:
   - Open with the exact role title and company
   - The body MUST address the key requirements from the brief — not a generic CV summary
   - For each matched requirement that matters for hiring (especially hard skills/tools named in the brief), explicitly state your experience and cite a concrete project/role
   - Example: if the LinkedIn brief requires Django and the CV shows Django, say so with how you used it
   - Expand on responsibilities from the brief that align with your background (do not ignore them)
   - Do NOT invent skills absent from candidate materials
   - For unmatched hard requirements, do not claim them
   - 4–6 paragraphs is fine when the brief has many requirements — cover the substance
   - If cover letter samples exist, match voice/structure only — still write a NEW letter for this listing

=== JOB LISTING (PRIMARY — full LinkedIn / Indeed brief) ===
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
URL: ${job.applicationUrl}

STRUCTURED REQUIREMENTS (may be incomplete — trust FULL POSTING TEXT more):
${structuredRequirements}

PARSED DESCRIPTION SUMMARY:
${(job.description || "").slice(0, 8000)}

FULL POSTING TEXT (authoritative — extract requirements from here):
${postingBody || "(no posting text — use structured requirements only)"}

PRIOR MATCH ANALYSIS (secondary hint):
${matchReasoning}
Matched strengths: ${strengths}
Gaps: ${missing}

=== CANDIDATE EVIDENCE (secondary — prove fit for the listing) ===
${candidateBlock}

Return JSON:
{
  "requirementMatches": [{ "requirement": "...", "candidateEvidence": "...", "matched": true }],
  "coverLetter": "..."
}`,
    coverLetterSchema,
    { userId: context.userId, operation: "cover_letter_generate" }
  );

  const matchedCount = result.requirementMatches.filter((m) => m.matched).length;
  console.log(
    `[Cover letter] ${job.title} @ ${job.company}: ${matchedCount}/${result.requirementMatches.length} listing requirements matched to evidence`
  );

  const sources: CoverLetterSources = {
    listingUrl: job.applicationUrl,
    listingTextChars: postingBody.length,
    listingText: postingBody,
    structuredRequirements,
    requirementMatches: result.requirementMatches,
    generatedAt: new Date().toISOString(),
  };

  return {
    coverLetter: result.coverLetter.trim(),
    requirementMatches: result.requirementMatches,
    sources,
  };
}

export async function generateApplicationMaterials(
  job: Job,
  context: CandidateContext,
  match: JobMatch,
  language: CoverLetterLanguage = "en"
) {
  const candidateBlock = formatContextForPrompt(context, 12000);
  const requirements = jobRequirementsBlock(job);

  return generateStructured(
    `You are an expert career coach writing job application materials.
The JOB LISTING requirements are the primary driver. Candidate resume/portfolio are evidence only.

${languageInstructions(language)}
(The coverLetter must be fully in that language. resumeSummary and customAnswers may stay in English unless language is Dutch — if Dutch, write those in Dutch too.)

REQUIREMENTS:
1. coverLetter: A complete, personalized cover letter (3-4 paragraphs) for "${job.title}" at ${job.company}.
   - Open by naming the exact role title and company
   - Walk through the job listing's key requirements and map each to concrete resume/portfolio evidence
   - If the job needs a skill (e.g. Django) and the candidate has it, say so with a specific example — do not write a generic bio
   - Professional first-person tone — NOT a generic template
   - If COVER LETTER SAMPLES are provided, match voice/structure only — write a NEW letter for this job
2. resumeSummary: A 2-3 sentence summary tailored to this role's requirements
3. customAnswers: Array of { "question": "...", "answer": "..." } — NOT an object map. Thoughtful answers tailored to this job.

Return JSON with customAnswers as an ARRAY like:
"customAnswers": [{ "question": "Why do you want this role?", "answer": "..." }]

=== JOB LISTING (PRIMARY) ===
JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB REQUIREMENTS:
${requirements || "(see description)"}
JOB DESCRIPTION:
${job.description.slice(0, 10000)}

MATCH ANALYSIS: ${match.reasoning}
STRENGTHS: ${match.strengths.join(", ")}

=== CANDIDATE EVIDENCE ===
${candidateBlock}

Answer these questions in customAnswers (use exact question text):
${COMMON_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
    materialsSchema,
    { userId: context.userId, operation: "application_generate" }
  );
}
