import type { CommuteMode, UserProfile, WorkArrangement } from "@/lib/types";
import {
  commuteMaxMinutesToForm,
  parseCommuteMaxMinutesFromForm,
} from "@/lib/commute/helpers";
import { normalizePreferredCountries } from "@/lib/job-search/countries";
import { normalizeWorkPreferences } from "@/lib/job-search/work-preference";

export interface ProfileFormValues {
  name: string;
  email: string;
  phoneNumber: string;
  linkedInUrl: string;
  githubUrl: string;
  portfolioUrls: string;
  preferredCountry: string;
  workPreferences: WorkArrangement[];
  jobPreferences: string;
  /** Comma-separated language names */
  languagesSpoken: string;
  homeLocation: string;
  commuteMode: CommuteMode | "";
  commuteMaxMinutes: string;
  commuteNoLimit: boolean;
  /** Only show jobs in the home-base city (stores commuteMaxMinutes = 0). */
  commuteHomeBaseOnly: boolean;
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
  const commuteForm = commuteMaxMinutesToForm(profile.commuteMaxMinutes);
  return {
    name: profile.name,
    email: profile.email,
    phoneNumber: profile.phoneNumber ?? phone ?? "",
    linkedInUrl: profile.linkedInUrl ?? "",
    githubUrl: profile.githubUrl ?? "",
    portfolioUrls: profile.portfolioUrls.join(", "),
    preferredCountry: profile.preferredCountries[0] ?? "",
    workPreferences: normalizeWorkPreferences(profile),
    jobPreferences: profile.jobPreferences ?? "",
    languagesSpoken: (profile.languagesSpoken ?? []).join(", "),
    homeLocation: profile.homeLocation ?? "",
    commuteMode: profile.commuteMode ?? "",
    commuteMaxMinutes: commuteForm.minutes,
    commuteNoLimit: commuteForm.noLimit,
    commuteHomeBaseOnly: commuteForm.homeBaseOnly,
  };
}

export function formValuesToProfileUpdate(
  values: ProfileFormValues,
  existing: UserProfile
): Partial<UserProfile> {
  const languages = parseLanguagesSpoken(values.languagesSpoken);
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
    workPreferences: values.workPreferences,
    jobPreferences: values.jobPreferences.trim() || undefined,
    languagesSpoken: languages.length > 0 ? languages : [],
    homeLocation,
    commuteMode,
    commuteMaxMinutes,
    onboardingComplete: existing.onboardingComplete,
    settings: existing.settings,
    resume: existing.resume,
  };
}
