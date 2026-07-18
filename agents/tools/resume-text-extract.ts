import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { PDFParse } from "pdf-parse";
import { downloadBuffer } from "@/services/storage";
import { getResumeExtension, getResumeMimeType } from "@/lib/resume/files";
import { generateText } from "@/lib/gemini/client";
import { generateTextFromDocument } from "@/lib/gemini/document";

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractDocText(buffer: Buffer): Promise<string> {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return doc.getBody();
}

async function extractWithLibrary(
  buffer: Buffer,
  ext: ReturnType<typeof getResumeExtension>
): Promise<string> {
  switch (ext) {
    case ".pdf":
      return extractPdfText(buffer);
    case ".docx":
      return extractDocxText(buffer);
    case ".doc":
      return extractDocText(buffer);
    default:
      return "";
  }
}

async function refineResumeTextWithAi(
  text: string,
  userId?: string
): Promise<string> {
  return generateText(
    `Extract and return ALL text content from this resume.
Preserve sections, job titles, employers, dates, education, skills, and contact info.
Return only the resume text with no commentary or markdown fences.

RESUME:
${text.slice(0, 28000)}`,
    { userId, operation: "resume_text_extraction" }
  );
}

async function extractPdfWithAi(
  buffer: Buffer,
  fileName: string,
  userId?: string
): Promise<string> {
  return generateTextFromDocument(
    buffer,
    getResumeMimeType(fileName),
    `Extract all text from this resume document.
Return only the raw resume text, preserving structure (sections, job titles, dates, skills).
Do not add commentary.`,
    { userId, operation: "resume_text_extraction" }
  );
}

/** AI-first resume text extraction with library fallback. */
export async function extractResumeText(
  storagePath: string,
  fileName: string,
  userId?: string
): Promise<string> {
  const buffer = await downloadBuffer(storagePath);
  const ext = getResumeExtension(fileName);
  if (!ext) {
    throw new Error("Unsupported resume format. Use PDF or Word (.pdf, .doc, .docx).");
  }

  let libraryText = "";
  try {
    libraryText = (await extractWithLibrary(buffer, ext)).trim();
  } catch {
    // library parse may fail on scanned PDFs — Gemini can still try
  }

  if (ext === ".pdf") {
    try {
      const aiText = (await extractPdfWithAi(buffer, fileName, userId)).trim();
      if (aiText.length > 50) return aiText;
    } catch (e) {
      console.warn("[Resume] Gemini PDF extraction failed:", e);
    }
  }

  if (libraryText) {
    try {
      const refined = (await refineResumeTextWithAi(libraryText, userId)).trim();
      return refined || libraryText;
    } catch (e) {
      console.warn("[Resume] Gemini text refinement failed:", e);
      return libraryText;
    }
  }

  throw new Error("Could not extract text from resume file");
}
