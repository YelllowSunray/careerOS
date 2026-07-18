import type { Timestamp } from "firebase-admin/firestore";

export type WorkPreference = "remote" | "hybrid" | "onsite" | "any";
export type ExperienceLevel = "junior" | "mid" | "senior" | "staff" | "principal";
export type ApplicationStatus =
  | "draft"
  | "ready"
  | "applying"
  | "applied"
  | "interview"
  | "rejected"
  | "offer";
export type WorkflowType = "find_jobs" | "apply_jobs" | "process_profile";
export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "paused";

export interface WorkExperience {
  title: string;
  company: string;
  startDate?: string;
  endDate?: string;
  description: string;
  technologies: string[];
}

export interface ResumeProject {
  name: string;
  description: string;
  technologies: string[];
}

export interface Education {
  institution: string;
  degree: string;
  field?: string;
  graduationYear?: string;
}

export interface Certification {
  name: string;
  issuer?: string;
  year?: string;
}

export type JobBoard =
  | "linkedin"
  | "indeed"
  | "remotive"
  | "arbeitnow"
  | "remoteok"
  | "adzuna";

export const API_JOB_BOARDS: JobBoard[] = [
  "remotive",
  "arbeitnow",
  "remoteok",
  "adzuna",
];

export const PLAYWRIGHT_JOB_BOARDS: JobBoard[] = ["linkedin", "indeed"];

export interface UserSettings {
  fitScoreThreshold: number;
  autoApply: boolean;
  jobBoards?: JobBoard[];
  /** Playwright browse URLs — use {query} as search placeholder */
  playwrightJobSearchUrls?: string[];
  /** Company career page URLs to crawl */
  careerPageUrls?: string[];
}

export interface UploadedDocument {
  id: string;
  storagePath: string;
  fileName: string;
  contentType?: string;
  uploadedAt: string;
  /** Extracted plain text for AI context */
  rawText?: string;
}

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  phoneNumber?: string;
  linkedInUrl?: string;
  githubUrl?: string;
  portfolioUrls: string[];
  preferredCountries: string[];
  workPreference: WorkPreference;
  /** Free-text: employment type, schedule, location, industry, seniority, etc. */
  jobPreferences?: string;
  resume?: {
    storagePath: string;
    fileName: string;
    contentType?: string;
    uploadedAt: string;
  };
  /** Past cover letters used as voice/structure references when writing new ones. */
  coverLetters?: UploadedDocument[];
  onboardingComplete: boolean;
  settings: UserSettings;
  updatedAt: string;
}

export interface ResumeData {
  userId: string;
  rawText: string;
  extracted: {
    phoneNumber?: string;
    skills: string[];
    experience: WorkExperience[];
    projects: ResumeProject[];
    technologies: string[];
    education: Education[];
    certifications: Certification[];
  };
  processedAt: string;
  version: number;
}

export interface PortfolioProject {
  name: string;
  description: string;
  technologies: string[];
  links: string[];
  sourceUrl: string;
}

export interface PortfolioSite {
  id: string;
  userId: string;
  url: string;
  status: "pending" | "crawling" | "complete" | "failed";
  pagesCrawled: number;
  pageTexts: { url: string; title: string; text: string }[];
  structuredProjects: PortfolioProject[];
  extracted?: {
    skills: string[];
    technologies: string[];
    summary?: string;
  };
  error?: string;
  completedAt?: string;
}

export interface InferredRole {
  role: string;
  confidence: number;
  approved: boolean;
}

export interface CandidateProject {
  name: string;
  description: string;
  technologies: string[];
  links: string[];
  source: "resume" | "portfolio" | "github" | "linkedin";
}

export interface CandidateProfile {
  userId: string;
  skills: string[];
  projects: CandidateProject[];
  technologies: string[];
  inferredRoles: InferredRole[];
  experienceLevel: ExperienceLevel;
  strengths: string[];
  gaps: string[];
  sources: {
    resume: boolean;
    portfolio: boolean;
    linkedin: boolean;
    github: boolean;
  };
  lastGeneratedAt: string;
  version: number;
}

export interface JobRequirement {
  skill: string;
  description?: string;
}

export interface Job {
  id: string;
  userId: string;
  title: string;
  company: string;
  companyUrl?: string;
  applicationUrl: string;
  source: "career_page" | "ats" | "job_board";
  sourcePlatform?: string;
  location: string;
  remoteType?: WorkPreference;
  salary?: { min?: number; max?: number; currency: string };
  description: string;
  requirements: {
    required: JobRequirement[];
    preferred: JobRequirement[];
  };
  extractedSkills: string[];
  discoveredVia: string[];
  discoveredAt: string;
  status: "discovered" | "matched" | "archived";
}

export interface MissingSkill {
  skill: string;
  isHardRequirement: boolean;
}

export interface JobMatch {
  id: string;
  userId: string;
  jobId: string;
  fitScore: number;
  strengths: string[];
  missingSkills: MissingSkill[];
  applyRecommendation: boolean;
  reasoning: string;
  /** How this job aligns with the candidate's stated job preferences */
  preferenceAlignment?: string;
  /** Whether the role broadly matches stated job preferences */
  preferencesMatch?: boolean;
  matchedAt: string;
}

export type CoverLetterLanguage = "en" | "nl";

export interface CoverLetterRequirementMatch {
  requirement: string;
  candidateEvidence: string;
  matched: boolean;
}

/** Debug snapshot of what job-brief text the AI saw when writing the letter. */
export interface CoverLetterSources {
  listingUrl: string;
  listingTextChars: number;
  /** Full posting text passed to the model (may be truncated). */
  listingText: string;
  structuredRequirements: string;
  requirementMatches: CoverLetterRequirementMatch[];
  generatedAt: string;
}

export interface ApplicationMaterials {
  coverLetter: string;
  /** Language used when the cover letter was generated */
  coverLetterLanguage?: CoverLetterLanguage;
  coverLetterSources?: CoverLetterSources;
  resumeSummary: string;
  customAnswers: { question: string; answer: string }[];
}

export interface Application {
  id: string;
  userId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  fitScore: number;
  materials: ApplicationMaterials;
  applicationUrl: string;
  browserSessionId?: string;
  jobDescription?: string;
  error?: string;
  createdAt: string;
  appliedAt?: string;
  updatedAt: string;
}

export interface WorkflowStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  userId: string;
  type: WorkflowType;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  config: Record<string, unknown>;
  startedAt: string;
  /** Updated each search round so continuous find_jobs is not marked stale. */
  lastActivityAt?: string;
  completedAt?: string;
  error?: string;
}

export interface BrowserStep {
  step: number;
  action: string;
  selector?: string;
  value?: string;
  screenshotPath?: string;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface BrowserSession {
  id: string;
  userId: string;
  applicationId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "paused" | "preview";
  steps: BrowserStep[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export type FirestoreTimestamp = Timestamp;
