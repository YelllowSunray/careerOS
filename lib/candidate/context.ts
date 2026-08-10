import {
  getProfile,
  getResume,
  getPortfolioSites,
  getCandidateProfile,
  getLinkedInProfile,
  getFeedbackPreferenceState,
} from "@/services/firestore";
import { getPrimaryCountry } from "@/lib/job-search/countries";
import { formatCommuteForPrompt } from "@/lib/commute/helpers";
import {
  formatWorkPreferences,
  normalizeWorkPreferences,
} from "@/lib/job-search/work-preference";
import { formatTargetRolesForPrompt } from "@/lib/job-search/target-roles";
import { formatCareerIntentForPrompt } from "@/lib/job-search/career-intent";
import { formatFeedbackPreferencesForPrompt } from "@/agents/tools/job-feedback";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { ResumeData, PortfolioSite } from "@/lib/types";

const EMPTY_EXTRACTED: ResumeData["extracted"] = {
  skills: [],
  experience: [],
  projects: [],
  technologies: [],
  education: [],
  certifications: [],
};

export async function buildCandidateContext(
  userId: string
): Promise<CandidateContext> {
  const [profile, resume, portfolioSites, structuredProfile, linkedInProfile, feedbackPreferences] =
    await Promise.all([
      getProfile(userId),
      getResume(userId),
      getPortfolioSites(userId),
      getCandidateProfile(userId),
      getLinkedInProfile(userId),
      getFeedbackPreferenceState(userId),
    ]);

  if (!profile) {
    throw new Error("Profile not found");
  }

  const normalizedProfile = {
    ...profile,
    workPreferences: normalizeWorkPreferences(profile),
  };

  const resumeRawText = resume?.rawText?.trim() ?? "";
  const portfolioRawText = portfolioSites
    .flatMap((s) => s.pageTexts ?? [])
    .map((p) => `URL: ${p.url}\nTitle: ${p.title}\n${p.text}`)
    .join("\n\n---\n\n");

  const coverLetterSamplesText = (normalizedProfile.coverLetters ?? [])
    .map((c, i) => {
      const body = c.rawText?.trim();
      if (!body) return null;
      return `--- Sample ${i + 1}: ${c.fileName} ---\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const linkedInRawText = buildLinkedInContextText(linkedInProfile);
  const portfolioStructured = mergePortfolioExtracted(portfolioSites);

  return {
    userId,
    profile: normalizedProfile,
    resumeRawText,
    portfolioRawText,
    coverLetterSamplesText,
    linkedInRawText,
    linkedInProfile,
    resumeStructured: resume?.extracted ?? null,
    portfolioStructured,
    structuredProfile,
    feedbackPreferences,
    hasRawSources:
      resumeRawText.length > 0 ||
      portfolioRawText.length > 0 ||
      linkedInRawText.length > 0,
  };
}

function buildLinkedInContextText(
  linkedIn: Awaited<ReturnType<typeof getLinkedInProfile>>
): string {
  if (!linkedIn || linkedIn.status !== "complete") return "";
  const parts: string[] = [];
  if (linkedIn.headline) parts.push(`Headline: ${linkedIn.headline}`);
  if (linkedIn.summary) parts.push(`About:\n${linkedIn.summary}`);
  if (linkedIn.skills.length) {
    parts.push(`Skills: ${linkedIn.skills.join(", ")}`);
  }
  if (linkedIn.experience.length) {
    parts.push(
      "Experience:\n" +
        linkedIn.experience
          .map(
            (e) =>
              `- ${e.title} @ ${e.company}${e.description ? `\n  ${e.description}` : ""}`
          )
          .join("\n")
    );
  }
  if (linkedIn.rawText?.trim()) {
    parts.push("", "=== FULL PROFILE TEXT ===", linkedIn.rawText.trim());
  }
  return parts.join("\n\n").trim();
}

function mergePortfolioExtracted(
  sites: Awaited<ReturnType<typeof getPortfolioSites>>
): PortfolioSite["extracted"] | null {
  const extracted = sites.map((s) => s.extracted).filter(Boolean) as NonNullable<
    PortfolioSite["extracted"]
  >[];
  if (extracted.length === 0) return null;

  return {
    skills: [...new Set(extracted.flatMap((e) => e.skills))],
    technologies: [...new Set(extracted.flatMap((e) => e.technologies))],
    summary: extracted.map((e) => e.summary).filter(Boolean).join(" "),
  };
}

/** Build a compact text block for Gemini prompts (raw-first). */
export function formatContextForPrompt(ctx: CandidateContext, maxChars = 20000): string {
  const parts: string[] = [
    `Name: ${ctx.profile.name}`,
    `Email: ${ctx.profile.email}`,
    ctx.profile.phoneNumber ? `Phone: ${ctx.profile.phoneNumber}` : "",
    ctx.profile.linkedInUrl ? `LinkedIn: ${ctx.profile.linkedInUrl}` : "",
    ctx.profile.githubUrl ? `GitHub: ${ctx.profile.githubUrl}` : "",
    `Preferred country: ${
      (() => {
        const c = getPrimaryCountry(ctx.profile.preferredCountries);
        if (!c) return "not set";
        if (c === "Worldwide") return "Everywhere (all countries)";
        return c;
      })()
    }`,
    `Work preference: ${formatWorkPreferences(normalizeWorkPreferences(ctx.profile))}`,
    (ctx.profile.languagesSpoken ?? []).length > 0
      ? `Languages spoken: ${(ctx.profile.languagesSpoken ?? []).join(", ")}`
      : "Languages spoken: (not set — treat unknown; fail jobs that clearly require a specific language beyond optional English)",
    ctx.profile.jobPreferences?.trim()
      ? `Job preferences: ${ctx.profile.jobPreferences.trim()}`
      : "",
    formatCareerIntentForPrompt(ctx.profile),
    formatTargetRolesForPrompt(ctx.profile),
    formatCommuteForPrompt(ctx.profile),
    formatFeedbackPreferencesForPrompt(ctx.feedbackPreferences),
    "",
    "=== RESUME (source of truth) ===",
    ctx.resumeRawText || "(no resume text)",
    "",
    "=== LINKEDIN PROFILE (source of truth) ===",
    ctx.linkedInRawText ||
      (ctx.profile.linkedInUrl
        ? `(LinkedIn URL set: ${ctx.profile.linkedInUrl} — profile not ingested yet; run Re-analyze)`
        : "(no LinkedIn profile)"),
    "",
    "=== PORTFOLIO (source of truth) ===",
    ctx.portfolioRawText || "(no portfolio content)",
  ];

  if (ctx.coverLetterSamplesText.trim()) {
    parts.push(
      "",
      "=== COVER LETTER SAMPLES (voice & structure reference — do not copy verbatim) ===",
      ctx.coverLetterSamplesText
    );
  }

  if (ctx.portfolioStructured) {
    parts.push(
      "",
      "=== PORTFOLIO AI EXTRACTION (cache) ===",
      JSON.stringify(ctx.portfolioStructured)
    );
  }

  if (ctx.structuredProfile) {
    parts.push(
      "",
      "=== STRUCTURED SUMMARY (cache, optional) ===",
      JSON.stringify({
        skills: ctx.structuredProfile.skills,
        technologies: ctx.structuredProfile.technologies,
        roles: ctx.structuredProfile.inferredRoles,
        experienceLevel: ctx.structuredProfile.experienceLevel,
        careerLadder: ctx.structuredProfile.careerLadder,
      })
    );
  }

  return parts.filter(Boolean).join("\n").slice(0, maxChars);
}

/** Top N inferred roles for job board search (by confidence). */
export function getTopInferredRolesFromContext(
  ctx: CandidateContext,
  limit = 3
): string[] {
  const fromProfile = (ctx.structuredProfile?.inferredRoles ?? [])
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .map((r) => r.role.trim())
    .filter(Boolean);

  if (fromProfile.length >= limit) {
    return [...new Set(fromProfile)].slice(0, limit);
  }

  const fromResume = (ctx.resumeStructured?.experience ?? [])
    .map((e) => e.title.trim())
    .filter(Boolean);

  return [...new Set([...fromProfile, ...fromResume])].slice(0, limit);
}

/**
 * Ladder destinations for search: next roles first, then stretch.
 * Prefer searchQuery when present; otherwise title.
 */
export function getLadderSearchQueriesFromContext(
  ctx: CandidateContext,
  limit = 6
): string[] {
  const ladder = ctx.structuredProfile?.careerLadder;
  if (!ladder) return [];

  const queries: string[] = [];
  for (const role of [...ladder.nextRoles, ...ladder.stretchRoles]) {
    const q = (role.searchQuery || role.title).trim().toLowerCase();
    if (q.length >= 3) queries.push(q);
  }
  return [...new Set(queries)].slice(0, limit);
}

/** Compact ladder block for match/search prompts. */
export function formatCareerLadderForPrompt(ctx: CandidateContext): string {
  const ladder = ctx.structuredProfile?.careerLadder;
  if (!ladder) return "";

  const fmt = (r: {
    title: string;
    branch: string;
    horizon: string;
    transferableStrengths: string[];
    gapsToClose: string[];
    whyScopeIncreases: string;
    searchQuery?: string;
  }) =>
    `- ${r.title} [${r.horizon}/${r.branch}]` +
    (r.searchQuery ? ` search:"${r.searchQuery}"` : "") +
    `\n  transfer: ${r.transferableStrengths.join("; ") || "—"}` +
    `\n  gaps: ${r.gapsToClose.join("; ") || "—"}` +
    `\n  scope: ${r.whyScopeIncreases || "—"}`;

  return [
    `CAREER LADDER (primary destinations — search & score against these):`,
    `Current: ${ladder.currentRole}`,
    `Strategy: ${ladder.summary}`,
    `Next roles (steps ~0–18 months):`,
    ...ladder.nextRoles.map(fmt),
    `Stretch roles (~1–2 years):`,
    ...ladder.stretchRoles.map(fmt),
  ].join("\n");
}

/** Top N skills for job board search (skills first, then technologies as fallback). */
export function getTopSkillsFromContext(
  ctx: CandidateContext,
  limit = 3
): string[] {
  const skills = [
    ...(ctx.structuredProfile?.skills ?? []),
    ...(ctx.resumeStructured?.skills ?? []),
    ...(ctx.portfolioStructured?.skills ?? []),
    ...(ctx.linkedInProfile?.skills ?? []),
  ];
  const technologies = [
    ...(ctx.structuredProfile?.technologies ?? []),
    ...(ctx.resumeStructured?.technologies ?? []),
    ...(ctx.portfolioStructured?.technologies ?? []),
  ];

  const uniqueSkills = [...new Set(skills.map((s) => s.trim()).filter(Boolean))];
  const uniqueTech = technologies
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((t) => !uniqueSkills.some((s) => s.toLowerCase() === t.toLowerCase()));

  return [...uniqueSkills, ...uniqueTech].slice(0, limit);
}

export function getSearchTermsFromContext(ctx: CandidateContext): string[] {
  const fromStructured = [
    ...(ctx.structuredProfile?.technologies ?? []),
    ...(ctx.structuredProfile?.skills ?? []),
    ...(ctx.resumeStructured?.technologies ?? []),
    ...(ctx.resumeStructured?.skills ?? []),
    ...(ctx.portfolioStructured?.technologies ?? []),
    ...(ctx.portfolioStructured?.skills ?? []),
  ];

  if (fromStructured.length > 0) {
    return [...new Set(fromStructured.map((s) => s.trim()).filter(Boolean))].slice(0, 8);
  }

  const text = `${ctx.resumeRawText} ${ctx.portfolioRawText}`.toLowerCase();
  const techPatterns = [
    "react", "next.js", "nextjs", "typescript", "javascript", "node.js", "nodejs",
    "python", "java", "firebase", "aws", "docker", "kubernetes", "graphql",
    "tailwind", "vue", "angular", "go", "rust", "sql", "postgresql", "mongodb",
    "machine learning", "ai", "full stack", "frontend", "backend",
  ];

  const found = techPatterns.filter((t) => text.includes(t));
  return [...new Set(found)].slice(0, 8);
}

export function emptyResumeExtracted(): ResumeData["extracted"] {
  return { ...EMPTY_EXTRACTED };
}
