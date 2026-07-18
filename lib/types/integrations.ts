export interface LinkedInProfileExperience {
  title: string;
  company: string;
  description: string;
}

/** Scraped + optionally AI-structured LinkedIn /in/ profile for matching. */
export interface LinkedInProfileData {
  userId: string;
  url: string;
  headline?: string;
  summary?: string;
  skills: string[];
  experience: LinkedInProfileExperience[];
  /** Full page text used as matching evidence */
  rawText?: string;
  status: "pending" | "complete" | "failed";
  error?: string;
  fetchedAt: string;
}

/** @deprecated Use LinkedInProfileData — kept for older imports */
export type LinkedInProfile = Omit<
  LinkedInProfileData,
  "userId" | "status" | "fetchedAt" | "rawText" | "error"
> & {
  url: string;
  skills: string[];
  experience: LinkedInProfileExperience[];
};

export interface GitHubProfile {
  url: string;
  username: string;
  bio?: string;
  repos: {
    name: string;
    description: string;
    languages: string[];
    url: string;
  }[];
}
