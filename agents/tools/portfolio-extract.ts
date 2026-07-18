import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { coerceStringArray } from "@/lib/gemini/coerce";
import type { PortfolioProject } from "@/lib/types";

const stringArray = z.array(z.string());

export const portfolioExtractionSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const o = raw as Record<string, unknown>;
    return {
      ...o,
      skills: coerceStringArray(o.skills),
      technologies: coerceStringArray(o.technologies),
      summary: o.summary ? String(o.summary) : undefined,
      projects: Array.isArray(o.projects)
        ? o.projects.map((p) => {
            const proj = (p ?? {}) as Record<string, unknown>;
            return {
              name: String(proj.name ?? ""),
              description: String(proj.description ?? ""),
              technologies: coerceStringArray(proj.technologies),
              links: coerceStringArray(proj.links),
              sourceUrl: String(proj.sourceUrl ?? ""),
            };
          })
        : [],
    };
  },
  z.object({
    skills: stringArray,
    technologies: stringArray,
    summary: z.string().optional(),
    projects: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        technologies: stringArray,
        links: stringArray,
        sourceUrl: z.string(),
      })
    ),
  })
);

export type ExtractedPortfolio = z.infer<typeof portfolioExtractionSchema>;

export async function extractPortfolioData(
  pages: { url: string; title: string; text: string }[],
  userId?: string
): Promise<ExtractedPortfolio> {
  const content = pages
    .map((p) => `URL: ${p.url}\nTitle: ${p.title}\n${p.text}`)
    .join("\n\n---\n\n")
    .slice(0, 28000);

  return generateStructured(
    `You are an expert portfolio analyst. Extract structured career data from this portfolio website content.
Use only information present in the text. Do not invent projects or skills.

Return JSON with:
- skills: array of skill strings
- technologies: array of technology/tool strings
- summary: brief professional summary from the portfolio (optional)
- projects: array of { name, description, technologies, links, sourceUrl }

PORTFOLIO CONTENT:
${content || "No content."}`,
    portfolioExtractionSchema,
    { userId, operation: "portfolio_extraction" }
  );
}

export function toPortfolioProjects(
  extracted: ExtractedPortfolio
): PortfolioProject[] {
  return extracted.projects.map((p) => ({
    name: p.name,
    description: p.description,
    technologies: p.technologies,
    links: p.links,
    sourceUrl: p.sourceUrl,
  }));
}
