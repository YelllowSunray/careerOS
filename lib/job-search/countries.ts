/** Resolve job search location from profile.preferredCountries (onboarding value). */

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

/** First non-empty country from profile — skips legacy "remote" entries. */
export function getPrimaryCountry(countries: string[]): string | null {
  for (const raw of countries) {
    const country = raw.trim();
    if (!country) continue;
    if (/^remote$/i.test(country)) continue;
    return country;
  }
  return null;
}

export function normalizePreferredCountries(input: string): string[] {
  const country = input.trim();
  return country ? [country] : [];
}

/** LinkedIn/Indeed location param — uses profile country verbatim. */
export function resolveLinkedInLocation(
  countries: string[],
  workPreference: string
): string {
  const country = getPrimaryCountry(countries);
  if (country) return country;
  if (workPreference === "remote") return "Worldwide";
  return "Worldwide";
}

export function resolveIndeedDomain(countries: string[]): string {
  const country = getPrimaryCountry(countries);
  if (!country) return "www";
  const key = country.toLowerCase();
  if (INDEED_DOMAIN[key]) return INDEED_DOMAIN[key];
  for (const [name, domain] of Object.entries(INDEED_DOMAIN)) {
    if (key.includes(name)) return domain;
  }
  return "www";
}

/** Indeed `l=` param — profile country as entered (city or country). */
export function resolveIndeedLocation(countries: string[]): string | null {
  return getPrimaryCountry(countries);
}

export function resolveAdzunaCountryCode(countries: string[]): string {
  const country = getPrimaryCountry(countries);
  if (!country) return "us";
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
