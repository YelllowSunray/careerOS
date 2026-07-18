import { scrapeLinkedInProfile } from "@/agents/tools/linkedin-profile";
import type { LinkedInProfileData, GitHubProfile } from "@/lib/types/integrations";

/** Import LinkedIn /in/ profile via Playwright (+ saved session when available). */
export async function fetchLinkedInProfile(
  linkedInUrl: string,
  userId?: string
): Promise<LinkedInProfileData> {
  return scrapeLinkedInProfile(linkedInUrl, userId);
}

/**
 * Future: Import GitHub profile via GitHub REST API.
 * Stub returns null until GITHUB_TOKEN is configured.
 */
export async function fetchGitHubProfile(
  _githubUrl: string
): Promise<GitHubProfile | null> {
  return null;
}
