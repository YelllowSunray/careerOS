import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function wrapLines(text: string, maxChars = 85): string[] {
  const paragraphs = text.split(/\n+/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

export async function coverLetterToPdfBuffer(
  coverLetter: string,
  meta?: { candidateName?: string; jobTitle?: string; company?: string }
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([612, 792]);
  const margin = 50;
  const lineHeight = 14;
  const fontSize = 11;
  let y = 750;

  const header = [
    meta?.candidateName,
    meta?.jobTitle && meta?.company
      ? `Re: ${meta.jobTitle} at ${meta.company}`
      : null,
  ]
    .filter(Boolean)
    .join(" — ");

  if (header) {
    page.drawText(header, {
      x: margin,
      y,
      size: fontSize,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= lineHeight * 2;
  }

  for (const line of wrapLines(coverLetter)) {
    if (y < margin) {
      page = doc.addPage([612, 792]);
      y = 750;
    }
    if (line) {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0.15, 0.15, 0.15),
        maxWidth: 512,
      });
    }
    y -= lineHeight;
  }

  return Buffer.from(await doc.save());
}

export function isApplyDebugPreview(): boolean {
  if (process.env.APPLY_DEBUG_PREVIEW === "false") return false;
  return (
    process.env.APPLY_DEBUG_PREVIEW === "true" ||
    process.env.NODE_ENV === "development"
  );
}
