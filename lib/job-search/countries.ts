/** Resolve job search location from profile.preferredCountries (onboarding value). */

/** Canonical value stored when the candidate wants all countries. */
export const WORLDWIDE_COUNTRY = "Worldwide";

const INDEED_DOMAIN: Record<string, string> = {
  netherlands: "nl",
  nl: "nl",
  "united states": "www",
  usa: "www",
  us: "www",
  "united kingdom": "uk",
  uk: "uk",
  germany: "de",
  de: "de",
  canada: "ca",
  ca: "ca",
  australia: "au",
  au: "au",
  france: "fr",
  fr: "fr",
  india: "in",
  in: "in",
  ireland: "ie",
  ie: "ie",
  belgium: "be",
  be: "be",
  switzerland: "ch",
  ch: "ch",
  sweden: "se",
  se: "se",
  spain: "es",
  es: "es",
  italy: "it",
  it: "it",
  singapore: "sg",
  sg: "sg",
};

const ADZUNA_COUNTRY: Record<string, string> = {
  netherlands: "nl",
  "united states": "us",
  usa: "us",
  us: "us",
  "united kingdom": "gb",
  uk: "gb",
  germany: "de",
  canada: "ca",
  australia: "au",
  france: "fr",
  india: "in",
  ireland: "ie",
};

/** True for Everywhere / Worldwide / Global / all countries aliases. */
export function isWorldwideAlias(raw: string): boolean {
  const s = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  return (
    s === "worldwide" ||
    s === "world wide" ||
    s === "everywhere" ||
    s === "global" ||
    s === "anywhere" ||
    s === "world" ||
    s === "all" ||
    s === "any" ||
    s === "all countries" ||
    s === "any country" ||
    s === "all countries worldwide" ||
    s === "international"
  );
}

export function isWorldwideSearch(countries: string[] | null | undefined): boolean {
  if (!countries || countries.length === 0) return false;
  return countries.some((c) => isWorldwideAlias(String(c ?? "")));
}

/** Form display: show friendly "Everywhere" when stored as Worldwide. */
export function preferredCountryToForm(countries: string[]): string {
  const first = countries[0]?.trim() ?? "";
  if (!first) return "";
  if (isWorldwideAlias(first)) return "Everywhere";
  return first;
}

/** First non-empty country from profile — skips legacy "remote" entries.
 *  Also unwraps comma-separated blobs like "Africa, Asia, The Netherlands".
 *  Returns "Worldwide" when the candidate chose everywhere / all countries.
 */
export function getPrimaryCountry(countries: string[]): string | null {
  const tokens: string[] = [];
  for (const raw of countries) {
    for (const part of String(raw).split(/[,;/|]+/)) {
      const country = part.trim();
      if (!country) continue;
      if (/^remote$/i.test(country)) continue;
      tokens.push(country);
    }
  }
  if (tokens.length === 0) return null;

  if (tokens.some(isWorldwideAlias)) return WORLDWIDE_COUNTRY;

  // Prefer a concrete board-supported country over continents.
  const preferred = tokens.find((t) => {
    const k = t.toLowerCase();
    return (
      INDEED_DOMAIN[k] != null ||
      ADZUNA_COUNTRY[k] != null ||
      k.includes("nether") ||
      k.includes("nederland") ||
      k === "nl"
    );
  });
  if (preferred) {
    if (/nether|nederland|^nl$/i.test(preferred)) return "Netherlands";
    return preferred;
  }

  // Drop bare continents — they break LinkedIn location search.
  // (Worldwide is handled above; do not treat it as a continent.)
  const nonContinent = tokens.find(
    (t) => !/^(africa|asia|europe|eu)$/i.test(t.trim())
  );
  return nonContinent ?? null;
}

export function normalizePreferredCountries(input: string): string[] {
  const country = input.trim();
  if (!country) return [];
  if (isWorldwideAlias(country)) return [WORLDWIDE_COUNTRY];
  return [country];
}

/** LinkedIn location param — Worldwide when no country or everywhere mode. */
export function resolveLinkedInLocation(
  countries: string[],
  workPreference: string
): string {
  const country = getPrimaryCountry(countries);
  if (country && !isWorldwideAlias(country)) return country;
  if (workPreference === "remote" || !country || isWorldwideAlias(country ?? "")) {
    return WORLDWIDE_COUNTRY;
  }
  return WORLDWIDE_COUNTRY;
}

export function resolveIndeedDomain(countries: string[]): string {
  const country = getPrimaryCountry(countries);
  if (!country || isWorldwideAlias(country)) return "www";
  const key = country.toLowerCase();
  if (INDEED_DOMAIN[key]) return INDEED_DOMAIN[key];
  for (const [name, domain] of Object.entries(INDEED_DOMAIN)) {
    if (key.includes(name)) return domain;
  }
  return "www";
}

/** Indeed `l=` param — null means no location filter (everywhere). */
export function resolveIndeedLocation(countries: string[]): string | null {
  const country = getPrimaryCountry(countries);
  if (!country || isWorldwideAlias(country)) return null;
  return country;
}

export function resolveAdzunaCountryCode(countries: string[]): string {
  const country = getPrimaryCountry(countries);
  if (!country || isWorldwideAlias(country)) return "us";
  const key = country.toLowerCase();
  if (ADZUNA_COUNTRY[key]) return ADZUNA_COUNTRY[key];
  for (const [name, code] of Object.entries(ADZUNA_COUNTRY)) {
    if (key.includes(name)) return code;
  }
  return "us";
}

export function linkedInRemoteFilter(workPreference: string): string {
  return workPreference === "remote" ? "&f_WT=2" : "";
}

/**
 * Prefer structured workPreferences; also honor free-text jobPreferences that
 * clearly ask for remote-only when structured prefs are open/any.
 */
export function effectiveRemotePreference(
  workPreference: string,
  jobPreferences?: string | null
): string {
  if (workPreference === "remote") return "remote";
  // Multi-select hint: only force remote board filter when search hint is remote.
  if (workPreference !== "any" && workPreference !== "remote") {
    return workPreference;
  }
  const prefs = jobPreferences?.toLowerCase() ?? "";
  if (
    /\b(fully\s+)?remote\b/.test(prefs) ||
    /\bremote\s+(only|job|role|work|position|full[- ]?time)\b/.test(prefs) ||
    /\bfull[- ]?time\s+remote\b/.test(prefs)
  ) {
    return "remote";
  }
  return workPreference;
}

/** LinkedIn experience-level filter (f_E). Complements keyword seniority in queries. */
export function linkedInExperienceFilter(level: string): string {
  const filters: Record<string, string> = {
    junior: "&f_E=2,3",
    mid: "&f_E=3,4",
    senior: "&f_E=4",
    staff: "&f_E=4,5",
    principal: "&f_E=4,5",
  };
  return filters[level] ?? "";
}

export function indeedRemoteFilter(workPreference: string): string {
  return workPreference === "remote" ? "&remotejob=1" : "";
}

export function buildIndeedSearchUrl(
  query: string,
  countries: string[],
  workPreference: string,
  start = 0
): string {
  const domain = resolveIndeedDomain(countries);
  const location = resolveIndeedLocation(countries);
  const locationParam = location ? `&l=${encodeURIComponent(location)}` : "";
  const remoteParam = indeedRemoteFilter(workPreference);
  const startParam = start > 0 ? `&start=${start}` : "";
  return `https://${domain}.indeed.com/jobs?q=${encodeURIComponent(query)}${locationParam}${remoteParam}${startParam}&fromage=14`;
}
