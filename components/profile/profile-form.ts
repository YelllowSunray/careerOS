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
  };
}

export function formValuesToProfileUpdate(
  values: ProfileFormValues,
  existing: UserProfile
): Partial<UserProfile> {
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
    onboardingComplete: existing.onboardingComplete,
    settings: existing.settings,
    resume: existing.resume,
  };
}
