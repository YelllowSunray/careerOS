export const RESUME_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const RESUME_EXTENSIONS = [".pdf", ".doc", ".docx"] as const;
export type ResumeExtension = (typeof RESUME_EXTENSIONS)[number];

const MIME_BY_EXTENSION: Record<ResumeExtension, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function getResumeExtension(fileName: string): ResumeExtension | null {
  const lower = fileName.toLowerCase();
  return RESUME_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null;
}

export function getResumeMimeType(fileName: string): string {
  const ext = getResumeExtension(fileName);
  return ext ? MIME_BY_EXTENSION[ext] : "application/octet-stream";
}

export function isAllowedResumeFile(fileName: string): boolean {
  return getResumeExtension(fileName) !== null;
}

export function resumeFileTypeLabel(): string {
  return "PDF or Word (.pdf, .doc, .docx)";
}
