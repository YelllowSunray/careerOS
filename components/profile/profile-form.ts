import type { UserProfile, WorkPreference } from "@/lib/types";
import { normalizePreferredCountries } from "@/lib/job-search/countries";

export interface ProfileFormValues {
  name: string;
  email: string;
  phoneNumber: string;
  linkedInUrl: string;
  githubUrl: string;
  portfolioUrls: string;
  preferredCountry: string;
  workPreference: WorkPreference;
  jobPreferences: string;
  /** Comma-separated language names */
  languagesSpoken: string;
}

export function parseLanguagesSpoken(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;|/]+/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => l.replace(/\s+/g, " "))
    ),
  ];
}

export function profileToFormValues(
  profile: UserProfile,
  phone?: string
): ProfileFormValues {
  return {
    name: profile.name,
    email: profile.email,
    phoneNumber: profile.phoneNumber ?? phone ?? "",
    linkedInUrl: profile.linkedInUrl ?? "",
    githubUrl: profile.githubUrl ?? "",
    portfolioUrls: profile.portfolioUrls.join(", "),
    preferredCountry: profile.preferredCountries[0] ?? "",
    workPreference: profile.workPreference,
    jobPreferences: profile.jobPreferences ?? "",
    languagesSpoken: (profile.languagesSpoken ?? []).join(", "),
  };
}

export function formValuesToProfileUpdate(
  values: ProfileFormValues,
  existing: UserProfile
): Partial<UserProfile> {
  const languages = parseLanguagesSpoken(values.languagesSpoken);
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    phoneNumber: values.phoneNumber.trim() || undefined,
    linkedInUrl: values.linkedInUrl.trim() || undefined,
    githubUrl: values.githubUrl.trim() || undefined,
    portfolioUrls: values.portfolioUrls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    preferredCountries: normalizePreferredCountries(values.preferredCountry),
    workPreference: values.workPreference,
    jobPreferences: values.jobPreferences.trim() || undefined,
    languagesSpoken: languages.length > 0 ? languages : [],
    onboardingComplete: existing.onboardingComplete,
    settings: existing.settings,
    resume: existing.resume,
  };
}
