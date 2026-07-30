import type { CandidateContext } from "@/lib/types/candidate-context";
import type { CoverLetterLanguage, JobSearchLanguageSetting } from "@/lib/types";
import { getPrimaryCountry } from "@/lib/job-search/countries";

export type { JobSearchLanguageSetting };
export type ResolvedJobSearchLanguage = CoverLetterLanguage;
export type SearchLanguageStrategy = "single" | "mixed";

export interface SearchQueryPlan {
  query: string;
  language: ResolvedJobSearchLanguage;
}

const DUTCH_QUERY_HINTS =
  /\b(magazijn|logistiek|heftruck|orderpicker|teamleider|medewerker|begeleider|verpleeg|magazijnchef|coördinator|coordinator|distributie|warehousing|chef|monteur|productie|zorg|magazijnmedewerker)\b/i;

/** Rough guess for validating AI-tagged query language. */
export function guessQueryLanguage(query: string): ResolvedJobSearchLanguage {
  return DUTCH_QUERY_HINTS.test(query) ? "nl" : "en";
}

const DUTCH_LANGUAGE_ALIASES = /\b(dutch|nederlands|nl|vlaams|flemish)\b/i;

const DUTCH_MARKET_COUNTRIES = new Set([
  "netherlands",
  "nederland",
  "nl",
  "belgium",
  "belgië",
  "belgie",
  "belgique",
]);

const DUTCH_TEXT_HINTS =
  /\b(bij|van|voor|met|werkervaring|opleiding|magazijn|logistiek|medewerker|heftruck|orderpicker|roepnaam|geboortedatum|nationaliteit|rijbewijs|functie|ervaring|certificaat|diploma|wij\s+zoeken|wat\s+bieden\s+wij|eisen|taken|solliciteer|fulltime|parttime|dienstverband|arbeidsvoorwaarden|werkdagen|werktijden|nacht\s*diensten|overdag)\b/gi;

const ENGLISH_JOB_HINTS =
  /\b(experience|education|skills|developer|engineer|software|responsibilities|qualifications|requirements|we\s+offer|about\s+the\s+role|job\s+description|must\s+have|nice\s+to\s+have|apply\s+now|full[- ]time|part[- ]time)\b/gi;

export type ListingLanguage = CoverLetterLanguage;

/** Detect the language a job listing is written in (title + description). */
export function detectListingLanguage(
  title: string,
  description = ""
): ListingLanguage {
  const sample = `${title}\n${description}`.slice(0, 12000).toLowerCase();
  if (!sample.trim()) return "en";

  const dutchHits = (sample.match(DUTCH_TEXT_HINTS) ?? []).length;
  const englishHits = (sample.match(ENGLISH_JOB_HINTS) ?? []).length;

  if (dutchHits >= 2 && dutchHits > englishHits) return "nl";
  if (textLooksDutch(sample)) return "nl";
  return "en";
}

export function listingLanguageLabel(lang: ListingLanguage): string {
  return lang === "nl" ? "Dutch" : "English";
}

export function isDutchLanguageLabel(label: string): boolean {
  return DUTCH_LANGUAGE_ALIASES.test(label.trim());
}

export function isDutchPrimaryMarket(country?: string | null): boolean {
  if (!country) return false;
  const c = country.toLowerCase().trim();
  return (
    DUTCH_MARKET_COUNTRIES.has(c) ||
    c.includes("nether") ||
    c.includes("nederland")
  );
}

/** Heuristic: resume / prefs / ladder text is predominantly Dutch. */
export function textLooksDutch(text: string): boolean {
  const sample = text.slice(0, 10000).toLowerCase();
  if (!sample.trim()) return false;

  const dutchHits = (sample.match(DUTCH_TEXT_HINTS) ?? []).length;
  const englishHits = (
    sample.match(
      /\b(experience|education|skills|developer|engineer|software|responsibilities|qualifications)\b/g
    ) ?? []
  ).length;

  return dutchHits >= 3 && dutchHits >= englishHits;
}

function ladderText(context: CandidateContext): string {
  const ladder = context.structuredProfile?.careerLadder;
  if (!ladder) return "";
  return [
    ladder.currentRole,
    ...(ladder.nextRoles ?? []).flatMap((r) => [r.title, r.searchQuery]),
    ...(ladder.stretchRoles ?? []).flatMap((r) => [r.title, r.searchQuery]),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Resolve which language job-board keyword queries should use.
 * Auto: Dutch for NL/BE manual/service/logistics profiles with Dutch evidence; else English.
 */
export function resolveJobSearchLanguage(
  context: CandidateContext,
  setting: JobSearchLanguageSetting = "auto"
): ResolvedJobSearchLanguage {
  if (setting === "en" || setting === "nl") return setting;

  const country = getPrimaryCountry(context.profile.preferredCountries);
  const spoken = context.profile.languagesSpoken ?? [];
  const speaksDutch = spoken.some(isDutchLanguageLabel);
  const speaksOnlyEnglish =
    spoken.length > 0 &&
    spoken.every((l) => /\b(english|engels)\b/i.test(l.trim()));

  const resumeText = [
    context.resumeRawText,
    context.linkedInRawText,
    context.profile.jobPreferences,
  ]
    .filter(Boolean)
    .join("\n");
  const ladder = ladderText(context);

  const dutchMarket = isDutchPrimaryMarket(country);
  const dutchEvidence =
    textLooksDutch(resumeText) ||
    textLooksDutch(ladder) ||
    /\b(magazijn|logistiek|heftruck|warehousing|orderpicker)\b/i.test(ladder);

  if (dutchMarket && speaksDutch && dutchEvidence && !speaksOnlyEnglish) {
    return "nl";
  }

  if (dutchMarket && textLooksDutch(resumeText) && !speaksOnlyEnglish) {
    return "nl";
  }

  return "en";
}

export function jobSearchLanguageLabel(lang: ResolvedJobSearchLanguage): string {
  return lang === "nl" ? "Dutch" : "English";
}

export function jobSearchLanguageSettingLabel(
  setting: JobSearchLanguageSetting
): string {
  if (setting === "auto") return "Auto";
  return jobSearchLanguageLabel(setting);
}

/** Compact UI label, e.g. "mixed (3 NL + 1 EN)" or "Dutch only". */
export function formatSearchLanguageStrategyLabel(plan: {
  languageStrategy?: string;
  language?: string;
  queryPlans?: { language?: string }[];
  languageRationale?: string;
} | null | undefined): string | null {
  if (!plan) return null;
  const plans = Array.isArray(plan.queryPlans) ? plan.queryPlans : [];
  const nl = plans.filter((p) => p.language === "nl").length;
  const en = plans.filter((p) => p.language === "en").length;
  const strategy = plan.languageStrategy === "mixed" ? "mixed" : "single";

  if (plans.length > 0) {
    if (strategy === "mixed" && nl > 0 && en > 0) {
      return `mixed (${nl} NL + ${en} EN)`;
    }
    if (nl > 0 && en === 0) return `Dutch only (${nl} queries)`;
    if (en > 0 && nl === 0) return `English only (${en} queries)`;
    return `${strategy} (${nl} NL · ${en} EN)`;
  }

  if (strategy === "mixed") return "mixed languages";
  if (plan.language === "nl") return "Dutch only";
  if (plan.language === "en") return "English only";
  return null;
}

export function browserLocaleForSearch(
  lang: ResolvedJobSearchLanguage
): string {
  return lang === "nl" ? "nl-NL" : "en-US";
}

export function searchLanguagePromptBlock(
  lang: ResolvedJobSearchLanguage
): string {
  if (lang === "nl") {
    return `SEARCH LANGUAGE: Dutch (Nederlands) — REQUIRED for all searchQueries
- Write every query in Dutch using terms Dutch job boards actually use (LinkedIn NL, Indeed nl.indeed.com).
- Prefer local titles from the career ladder and CV: e.g. "magazijnmedewerker", "logistiek medewerker", "magazijnchef", "logistiek supervisor", "heftruck chauffeur", "orderpicker", "teamleider logistiek".
- Do NOT translate to English ("warehouse worker") unless that English phrase is standard on Dutch boards for this role.
- Seniority in Dutch listings: junior/medior/senior, teamleider, supervisor, chef, manager — match the candidate's level.`;
  }

  return `SEARCH LANGUAGE: English
- Write searchQueries in English (international/tech boards and English-language NL listings).
- Use standard board phrases: "senior software engineer", "frontend developer", etc. when relevant.`;
}

/** When user leaves language on Auto — AI decides single vs mixed. */
export function searchLanguageAutoDecisionBlock(
  context: CandidateContext
): string {
  const country = getPrimaryCountry(context.profile.preferredCountries) ?? "unknown";
  const spoken = (context.profile.languagesSpoken ?? []).join(", ") || "not set";
  const heuristic = resolveJobSearchLanguage(context, "auto");

  return `SEARCH LANGUAGE MODE: AUTO — YOU decide strategy (user did not lock a language)

Candidate market: ${country}
Languages spoken: ${spoken}
Heuristic primary hint (weak signal only): ${heuristic}

Return searchLanguageStrategy + primarySearchLanguage + per-query language tags.

DECISION FRAMEWORK — choose "single" OR "mixed":

Use strategy="single" (all 4 queries in ONE language) when:
- Tech / digital / white-collar (software, data, product, design, finance, consulting): NL LinkedIn uses English titles → primarySearchLanguage=en, ALL queries English
- Pure Dutch operational CV (magazijn, logistiek, productie, zorg) targeting local employers only → primarySearchLanguage=nl, ALL queries Dutch
- Stretch roles are still commonly posted in the same language as next roles

Use strategy="mixed" (split languages across queries) ONLY when:
- NL market + operational/hybrid career where BOTH vocabularies appear on boards (e.g. Dutch magazijn/teamleider roles AND English "warehouse supervisor" at multinationals)
- Ladder nextRoles are Dutch but 1 stretch/international title is standard in English on LinkedIn NL
- Candidate speaks both languages AND the secondary language unlocks a meaningfully different listing pool (not duplicate translations)

Mixed rules (strict):
- Still exactly 4 queries total — NEVER double the budget with full duplicates
- primarySearchLanguage = language for MOST queries (3 queries) 
- At most ONE query in the secondary language (4th slot) unless you have strong evidence both pools are equal — then max 2 secondary
- Secondary language queries must target a DIFFERENT employer pool (multinationals, English-only postings), not literal translations of primary queries
- Do NOT use mixed for pure software engineering — English-only is correct
- Do NOT use mixed just because candidate speaks two languages

For each searchQueries item return: { "query": "...", "language": "nl" | "en" }
Also return languageRationale: 1-2 sentences explaining single vs mixed choice.`;
}

/** User locked nl or en — AI must not override. */
export function searchLanguageLockedBlock(
  lang: ResolvedJobSearchLanguage
): string {
  return `SEARCH LANGUAGE MODE: LOCKED to ${lang === "nl" ? "Dutch" : "English"}
- searchLanguageStrategy MUST be "single"
- primarySearchLanguage MUST be "${lang}"
- ALL 4 searchQueries MUST use language "${lang}" — no mixed queries
- languageRationale: brief note that user locked this language`;
}

/** Generic fallback queries when ladder seeds are thin — localized by search language. */
export function genericFallbackQueries(
  level: import("@/lib/types").ExperienceLevel,
  lang: ResolvedJobSearchLanguage
): string[] {
  if (lang === "nl") {
    const nl: Record<
      import("@/lib/types").ExperienceLevel,
      string[]
    > = {
      junior: [
        "junior magazijnmedewerker",
        "starter logistiek",
        "orderpicker",
      ],
      mid: [
        "logistiek medewerker",
        "magazijnmedewerker",
        "heftruck chauffeur",
      ],
      senior: [
        "magazijnchef",
        "logistiek supervisor",
        "teamleider logistiek",
      ],
      staff: [
        "warehouse manager",
        "logistiek manager",
        "operations teamleider",
      ],
      principal: [
        "directeur logistiek",
        "hoofd magazijn",
        "supply chain manager",
      ],
    };
    return nl[level];
  }

  const en: Record<import("@/lib/types").ExperienceLevel, string[]> = {
    junior: [
      "junior frontend developer",
      "entry level web developer",
      "junior software engineer",
    ],
    mid: ["frontend developer", "full stack developer", "software engineer"],
    senior: [
      "senior frontend developer",
      "senior software engineer",
      "full stack developer",
    ],
    staff: ["staff software engineer", "principal engineer", "senior developer"],
    principal: [
      "principal engineer",
      "staff software engineer",
      "senior architect",
    ],
  };
  return en[level];
}
