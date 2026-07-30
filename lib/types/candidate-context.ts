import type {
  UserProfile,
  CandidateProfile,
  ResumeData,
  PortfolioSite,
  FeedbackPreferenceState,
} from "@/lib/types";
import type { LinkedInProfileData } from "@/lib/types/integrations";

/** Raw sources + optional structured cache — source of truth for AI agents. */
export interface CandidateContext {
  userId: string;
  profile: UserProfile;
  resumeRawText: string;
  portfolioRawText: string;
  /** Past cover letters (voice/structure references for new letters). */
  coverLetterSamplesText: string;
  /** Scraped LinkedIn /in/ profile text for matching. */
  linkedInRawText: string;
  linkedInProfile: LinkedInProfileData | null;
  resumeStructured: ResumeData["extracted"] | null;
  portfolioStructured: PortfolioSite["extracted"] | null;
  structuredProfile: CandidateProfile | null;
  /** AI-learned constraints from listing feedback ("Teach Career OS"). */
  feedbackPreferences: FeedbackPreferenceState | null;
  hasRawSources: boolean;
}
