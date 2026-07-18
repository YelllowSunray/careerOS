import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { formatContextForPrompt } from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { ApplicationMaterials } from "@/lib/types";

const fieldValueSchema = z.object({
  value: z.string(),
  confidence: z.number().optional(),
  source: z.string().optional(),
});

const answerSchema = z.object({
  answer: z.string(),
});

export interface JobContext {
  title: string;
  company: string;
  description?: string;
}

export interface ResolveFieldInput {
  fieldLabel: string;
  fieldType: string;
  fieldName?: string;
  context: CandidateContext;
  job: JobContext;
  userId: string;
  materials?: ApplicationMaterials;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function isCoverLetterField(label: string, name?: string): boolean {
  const combined = normalize(`${label} ${name ?? ""}`);
  return (
    combined.includes("cover letter") ||
    combined.includes("coverletter") ||
    combined.includes("letter of interest") ||
    combined.includes("motivation letter")
  );
}

export function isCoverLetterUploadField(
  label: string,
  fieldType: string,
  name?: string
): boolean {
  return fieldType === "file" && isCoverLetterField(label, name);
}

export function isOpenEndedField(label: string, fieldType: string, name?: string): boolean {
  if (fieldType === "textarea") return true;
  const combined = normalize(`${label} ${name ?? ""}`);
  return /why|describe|tell us|explain|what motivates|how would|interest in|passion|additional info|comments|essay|statement|proud of|good fit|choose this/.test(
    combined
  );
}

function findCustomAnswer(
  materials: ApplicationMaterials,
  label: string
): string | null {
  const norm = normalize(label);
  for (const qa of materials.customAnswers) {
    const q = normalize(qa.question);
    if (q.includes(norm) || norm.includes(q) || norm.split(" ").every((w) => q.includes(w))) {
      return qa.answer;
    }
  }
  return null;
}

async function extractFactualValue(
  input: ResolveFieldInput
): Promise<z.infer<typeof fieldValueSchema>> {
  const label = input.fieldLabel || input.fieldName || "unknown field";
  const contextBlock = formatContextForPrompt(input.context, 18000);

  return generateStructured(
    `You are filling out a job application form field.
Extract the correct factual value from the candidate's resume, portfolio, and profile.
Use profile contact info for name/email/phone fields.
Do NOT invent experience, employers, or credentials.
If the value cannot be found, return an empty string for "value".

FIELD LABEL: ${label}
FIELD TYPE: ${input.fieldType}
${input.fieldName ? `FIELD NAME: ${input.fieldName}` : ""}

CANDIDATE DATA:
${contextBlock}`,
    fieldValueSchema,
    { userId: input.userId, operation: "field_resolve" }
  );
}

async function generateFieldContent(
  input: ResolveFieldInput,
  mode: "cover_letter" | "answer"
): Promise<string> {
  const question = input.fieldLabel || input.fieldName || "Application question";
  const contextBlock = formatContextForPrompt(input.context, 18000);
  const jobBlock = `Role: ${input.job.title} at ${input.job.company}
${input.job.description ? input.job.description.slice(0, 4000) : ""}`;

  const prompt =
    mode === "cover_letter"
      ? `Write a complete, personalized cover letter for this job application.
Ground every claim in the candidate's resume, portfolio, and profile — do not fabricate.
Open by naming the exact role title and company. Connect 2-3 specific experiences to this job.
Write 3-4 paragraphs in first person, professional tone.
If COVER LETTER SAMPLES appear in the candidate context, match their voice and structure as a style reference, but write a NEW letter for this specific job (do not copy a sample).

JOB:
${jobBlock}

CANDIDATE:
${contextBlock}`
      : `Write a compelling, tailored answer to this job application form question.
Read the candidate's resume, portfolio, and profile to ground your response — do not fabricate.
Reference the specific role title and company where natural.
Match length to the question (short for brief fields, 2-4 paragraphs for essay questions).

FORM QUESTION: ${question}

JOB:
${jobBlock}

CANDIDATE:
${contextBlock}`;

  const result = await generateStructured(
    prompt,
    answerSchema,
    {
      userId: input.userId,
      operation: mode === "cover_letter" ? "cover_letter_generate" : "application_answer",
    }
  );

  return result.answer;
}

/**
 * Resolve a form field at apply time.
 * Open-ended and cover letter fields always get fresh AI from resume + portfolio + profile.
 * Factual fields (name, email, phone, etc.) are extracted from sources.
 */
export async function resolveApplicationFieldValue(
  input: ResolveFieldInput
): Promise<z.infer<typeof fieldValueSchema>> {
  const label = input.fieldLabel || input.fieldName || "";

  if (isCoverLetterField(label, input.fieldName)) {
    if (input.materials?.coverLetter?.trim()) {
      return {
        value: input.materials.coverLetter.trim(),
        confidence: 0.98,
        source: "application_materials",
      };
    }
    const answer = await generateFieldContent(input, "cover_letter");
    return { value: answer, confidence: 0.95, source: "ai_cover_letter" };
  }

  if (isOpenEndedField(label, input.fieldType, input.fieldName)) {
    const existing =
      input.materials && findCustomAnswer(input.materials, label);
    if (existing?.trim()) {
      return {
        value: existing.trim(),
        confidence: 0.95,
        source: "application_materials",
      };
    }
    const answer = await generateFieldContent(input, "answer");
    return { value: answer, confidence: 0.9, source: "ai_generated_answer" };
  }

  return extractFactualValue(input);
}
