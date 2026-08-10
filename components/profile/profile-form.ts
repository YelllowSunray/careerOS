import type { CommuteMode, UserProfile, WorkArrangement } from "@/lib/types";
import {
  commuteMaxMinutesToForm,
  parseCommuteMaxMinutesFromForm,
} from "@/lib/commute/helpers";
import {
  normalizePreferredCountries,
  preferredCountryToForm,
} from "@/lib/job-search/countries";
import { normalizeWorkPreferences } from "@/lib/job-search/work-preference";

/** Who you are — Profile details card. */
export interface IdentityFormValues {
  name: string;
  email: string;
  phoneNumber: string;
  linkedInUrl: string;
  githubUrl: string;
  portfolioUrls: string;
  /** Comma-separated language names */
  languagesSpoken: string;
}

/** How/where you want to search — Career intent card. */
export interface JobSearchFormValues {
  preferredCountry: string;
  workPreferences: WorkArrangement[];
  jobPreferences: string;
  homeLocation: string;
  commuteMode: CommuteMode | "";
  commuteMaxMinutes: string;
  commuteNoLimit: boolean;
  /** Only show jobs in the home-base city (stores commuteMaxMinutes = 0). */
  commuteHomeBaseOnly: boolean;
}

/** @deprecated Prefer IdentityFormValues + JobSearchFormValues */
export type ProfileFormValues = IdentityFormValues & JobSearchFormValues;

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

export function profileToIdentityForm(
  profile: UserProfile,
  phone?: string
): IdentityFormValues {
  return {
    name: profile.name,
    email: profile.email,
    phoneNumber: profile.phoneNumber ?? phone ?? "",
    linkedInUrl: profile.linkedInUrl ?? "",
    githubUrl: profile.githubUrl ?? "",
    portfolioUrls: profile.portfolioUrls.join(", "),
    languagesSpoken: (profile.languagesSpoken ?? []).join(", "),
  };
}

export function identityFormToUpdate(
  values: IdentityFormValues,
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
    languagesSpoken: languages.length > 0 ? languages : [],
    onboardingComplete: existing.onboardingComplete,
    settings: existing.settings,
    resume: existing.resume,
  };
}

export function profileToJobSearchForm(
  profile: UserProfile
): JobSearchFormValues {
  const commuteForm = commuteMaxMinutesToForm(profile.commuteMaxMinutes);
  return {
    preferredCountry: preferredCountryToForm(profile.preferredCountries),
    workPreferences: normalizeWorkPreferences(profile),
    jobPreferences: profile.jobPreferences ?? "",
    homeLocation: profile.homeLocation ?? "",
    commuteMode: profile.commuteMode ?? "",
    commuteMaxMinutes: commuteForm.minutes,
    commuteNoLimit: commuteForm.noLimit,
    commuteHomeBaseOnly: commuteForm.homeBaseOnly,
  };
}

export function jobSearchFormToUpdate(
  values: JobSearchFormValues,
  existing: UserProfile
): Partial<UserProfile> {
  const homeLocation = values.homeLocation.trim() || undefined;
  const commuteMode = values.commuteMode || undefined;
  const parsedMax = parseCommuteMaxMinutesFromForm(
    values.commuteMaxMinutes,
    values.commuteNoLimit,
    values.commuteHomeBaseOnly
  );
  const commuteMaxMinutes =
    homeLocation && (values.commuteHomeBaseOnly || commuteMode)
      ? parsedMax === undefined
        ? existing.commuteMaxMinutes
        : parsedMax
      : undefined;

  return {
    preferredCountries: normalizePreferredCountries(values.preferredCountry),
    workPreferences: values.workPreferences,
    jobPreferences: values.jobPreferences.trim() || undefined,
    homeLocation,
    commuteMode,
    commuteMaxMinutes,
  };
}

/** @deprecated Use profileToIdentityForm + profileToJobSearchForm */
export function profileToFormValues(
  profile: UserProfile,
  phone?: string
): ProfileFormValues {
  return {
    ...profileToIdentityForm(profile, phone),
    ...profileToJobSearchForm(profile),
  };
}

/** @deprecated Use identityFormToUpdate / jobSearchFormToUpdate */
export function formValuesToProfileUpdate(
  values: ProfileFormValues,
  existing: UserProfile
): Partial<UserProfile> {
  return {
    ...identityFormToUpdate(values, existing),
    ...jobSearchFormToUpdate(values, existing),
  };
}
