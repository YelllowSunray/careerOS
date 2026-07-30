import type { Timestamp } from "firebase-admin/firestore";

export type WorkPreference = "remote" | "hybrid" | "onsite" | "any";
/** Selectable work arrangements on the candidate profile (multi-select). */
export type WorkArrangement = "remote" | "hybrid" | "onsite";
export type CommuteMode = "car" | "bike" | "public_transit" | "walk";
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
  /** Auto-detect or force language for job-board keyword searches. */
  jobSearchLanguage?: JobSearchLanguageSetting;
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
  /**
   * Accepted work arrangements (multi-select). Empty = any of remote / hybrid / on-site.
   */
  workPreferences: WorkArrangement[];
  /** @deprecated Legacy single value — prefer workPreferences. Normalized on read. */
  workPreference?: WorkPreference;
  /** Free-text: employment type, schedule, location, industry, seniority, etc. */
  jobPreferences?: string;
  /**
   * Roles the candidate wants to search for (primary + related suggestions).
   * Enabled titles hard-drive discovery queries (3 of 4).
   */
  targetRoles?: TargetRolesPreference;
  /** Languages the candidate speaks (e.g. English, Dutch). Used as a hard job-eligibility filter. */
  languagesSpoken?: string[];
  /** Home base for commute screening (city or address, e.g. "Baarn, Netherlands"). */
  homeLocation?: string;
  /** Preferred commute mode when evaluating on-site/hybrid roles. */
  commuteMode?: CommuteMode;
  /** Max one-way commute minutes; 0 = home-base city only (UI: "Home base only"); null = no limit; undefined = not configured. */
  commuteMaxMinutes?: number | null;
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

/** AI-suggested role related to the candidate's primary target. */
export interface TargetRoleSuggestion {
  role: string;
  /** LinkedIn/Indeed-style keyword phrase */
  searchQuery: string;
  relatedness: "adjacent" | "stretch";
  /** Set when the CV evidence for this jump looks thin */
  hireabilityNote?: string;
}

/**
 * User-owned target roles for job search (survives re-analyze).
 * `enabled` = role titles checked for discovery (primary and/or suggestions).
 */
export interface TargetRolesPreference {
  primary: string;
  suggested: TargetRoleSuggestion[];
  enabled: string[];
  suggestedAt?: string;
}

/** Near-term next role (~0–18 months) or stretch (~1–2 years). */
export type LadderHorizon = "next" | "stretch";
/** Same job family vs adjacent sector/function move. */
export type LadderBranch = "same" | "adjacent";

/** One destination on the candidate's career ladder map. */
export interface CareerLadderRole {
  title: string;
  horizon: LadderHorizon;
  branch: LadderBranch;
  /** Strengths they already have that transfer into this role */
  transferableStrengths: string[];
  /** Gaps to close before / while in the role */
  gapsToClose: string[];
  /** Why this increases scope (team, stakeholders, decisions, market, IC→lead, etc.) */
  whyScopeIncreases: string;
  /** Optional LinkedIn/Indeed-style search phrase for this destination */
  searchQuery?: string;
}

/** Explicit ladder: current → next (steps) → stretch (destinations). */
export interface CareerLadder {
  currentRole: string;
  /** One-line strategy for how they climb */
  summary: string;
  /** 2–4 plausible next roles (same branch + adjacent) */
  nextRoles: CareerLadderRole[];
  /** 1–3 stretch roles ~1–2 years out */
  stretchRoles: CareerLadderRole[];
}

export interface CandidateProject {
  name: string;
  description: string;
  technologies: string[];
  links: string[];
  source: "resume" | "portfolio" | "github" | "linkedin";
}

/** AI suggestion for a credential that aids the next ladder move. */
export type EducationRecommendationType =
  | "certification"
  | "course"
  | "degree"
  | "license"
  | "training";

export type EducationRecommendationHorizon = "near" | "stretch";

export interface EducationRecommendation {
  /** Short name, e.g. "VCA Basis" or "APICS CSCP" */
  title: string;
  type: EducationRecommendationType;
  /** Provider or typical issuer when known (AI judgment) */
  provider?: string;
  /** Why this helps THIS candidate climb */
  rationale: string;
  /** Gaps / skills this closes (from ladder, matches, or market) */
  closesGaps: string[];
  /** Ladder roles this unlocks or strengthens */
  targetsLadderRoles: string[];
  /** 1 = highest priority */
  priority: number;
  horizon: EducationRecommendationHorizon;
  /**
   * Where the signal came from — AI may combine sources.
   * market = observed in matched job postings; ladder = destination gaps; knowledge = domain norms.
   */
  evidenceSources: Array<"market" | "ladder" | "profile" | "knowledge">;
  /** Optional: how often this showed up across matched jobs */
  marketSignalCount?: number;
}

export interface CandidateProfile {
  userId: string;
  skills: string[];
  projects: CandidateProject[];
  technologies: string[];
  inferredRoles: InferredRole[];
  /** AI career ladder map — primary driver for search & matching */
  careerLadder?: CareerLadder;
  experienceLevel: ExperienceLevel;
  strengths: string[];
  gaps: string[];
  /**
   * AI-ranked next certifications / courses / education that unlock ladder climbs,
   * informed by CV + market gaps from matched jobs.
   */
  educationRecommendations?: EducationRecommendation[];
  /** One-line AI strategy for the education path */
  educationRecommendationsSummary?: string;
  educationRecommendationsGeneratedAt?: string;
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
  /** Language the listing text is written in (not spoken-language requirements). */
  listingLanguage?: CoverLetterLanguage;
  extractedSkills: string[];
  discoveredVia: string[];
  discoveredAt: string;
  status: "discovered" | "matched" | "archived";
  /** Whether the posting still looks open / link alive */
  listingOpenStatus?: "open" | "closed" | "dead" | "unknown";
  listingOpenNotes?: string;
  listingOpenCheckedAt?: string;
  /** Indeed (or later) employee-satisfaction snapshot — denormalized for the card */
  companyReputation?: CompanyReputation;
}

export type CompanyReputationStatus = "ok" | "not_found" | "unavailable";

export interface CompanyReputation {
  rating?: number;
  reviewCount?: number;
  source: "indeed";
  sourceUrl?: string;
  summary?: string;
  status: CompanyReputationStatus;
  checkedAt: string;
}

/** Shared cache doc for company reputation (keyed by normalized company name). */
export interface CompanyReputationCache {
  id: string;
  companyName: string;
  rating?: number;
  reviewCount?: number;
  source: "indeed";
  sourceUrl?: string;
  summary?: string;
  status: CompanyReputationStatus;
  checkedAt: string;
  notes?: string;
}

export type GapLearnability = "must_have" | "learn_on_job" | "nice_to_have";

/**
 * AI primary eligibility for showing a job:
 * day_one / with_ramp = keep; not_eligible = hide (wrong craft or impossible day-1 bar).
 */
export type CoreCraftFit = "day_one" | "with_ramp" | "not_eligible";

export interface MissingSkill {
  skill: string;
  /**
   * AI judgment: must_have = day-1 non-negotiable (hide job if unmet);
   * learn_on_job = expected ramp while doing core work; nice_to_have = preference only.
   * Optional on older saved matches — fall back to isHardRequirement.
   */
  learnability?: GapLearnability;
  /** Derived: true when learnability === "must_have" (backward compatible). */
  isHardRequirement: boolean;
}

/** How this job sits on the candidate's ladder path. */
export type JobPathType = "step" | "stretch" | "destination" | "lateral";

export interface JobMatch {
  id: string;
  userId: string;
  jobId: string;
  fitScore: number;
  strengths: string[];
  missingSkills: MissingSkill[];
  applyRecommendation: boolean;
  reasoning: string;
  /** How this job aligns with the candidate's stated job preferences (soft signal) */
  preferenceAlignment?: string;
  /** Whether the role broadly matches stated job preferences (informational) */
  preferencesMatch?: boolean;
  /** AI pillar: how much value the candidate can contribute soon (0-100) */
  contributionScore?: number;
  contributionNotes?: string;
  /** AI pillar: capability / ladder growth (0-100) */
  learningScore?: number;
  learningNotes?: string;
  /** AI pillar: compensation quality / upside (0-100) */
  moneyScore?: number;
  moneyNotes?: string;
  /** Languages the posting hard-requires (from AI) */
  requiredLanguages?: string[];
  /** Whether candidate languages satisfy hard requirements */
  languageRequirementMet?: boolean;
  languageNotes?: string;
  /**
   * AI hard gate: false when the candidate lacks core must-have skills/credentials
   * for this role (wrong craft / non-negotiable gaps). Job must not be shown.
   */
  skillRequirementMet?: boolean;
  skillNotes?: string;
  /** AI judgment of same-craft day-1 / ramp eligibility (primary skill gate). */
  coreCraftFit?: CoreCraftFit;
  /** Whether commute fits profile limits (hard gate when max minutes set). */
  commuteRequirementMet?: boolean;
  commuteNotes?: string;
  /** One-way commute estimate in minutes when known. */
  estimatedCommuteMinutes?: number;
  /**
   * Scope step-up vs current role (0-100): team size, budget, stakeholders,
   * decision rights, market size, IC→lead — not title synonymy.
   */
  scopeIncrease?: number;
  scopeNotes?: string;
  /** step = near-term ladder next; stretch = ambitious climb; destination = direct ladder target; lateral = no climb */
  pathType?: JobPathType;
  /** Path narrative, e.g. "Risk Analyst → unlocks Senior Compliance in 1–2 moves" */
  ladderPath?: string;
  /** Ladder destination title this job maps to, if any */
  matchedDestination?: string;
  /**
 * AI hard gate from user listing feedback (e.g. "too senior").
 * false = hide while that feedback is active. Undefined = no feedback filter applied.
 */
  feedbackRequirementMet?: boolean;
  feedbackNotes?: string;
  /** Feedback ids that caused a hide decision */
  violatedFeedbackIds?: string[];
  matchedAt: string;
}

/** How strongly the AI agrees with the user's dislike. */
export type FeedbackAiStance =
  | "agree"
  | "soft_pushback"
  | "strong_pushback";

/** Theme the AI inferred — free judgment, not a fixed enum ban list. */
export type FeedbackTheme =
  | "too_senior"
  | "too_junior"
  | "wrong_craft"
  | "location_commute"
  | "compensation"
  | "company_stage"
  | "schedule_type"
  | "other";

/**
 * User dislike / preference feedback on a listing.
 * Drives AI filtering of other jobs after the user confirms learning.
 */
export interface JobFeedback {
  id: string;
  userId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  /** Free-text reason from the user */
  reason: string;
  /** Optional chip the user picked (hint only — AI reclassifies) */
  reasonHint?: string;
  /** AI-inferred theme after review */
  theme: FeedbackTheme;
  /**
   * AI-normalized constraint used when filtering other jobs
   * (e.g. "Avoid roles clearly above mid-level / requiring 10+ years leadership").
   */
  constraintSummary: string;
  /** AI stance when the feedback was reviewed */
  aiStance: FeedbackAiStance;
  /** What the AI told the user (pushback or agreement) */
  aiExplanation: string;
  /**
   * true = user confirmed "hide & learn" after AI review.
   * Pending reviews are not stored until confirm (or stored as draft — we only save on confirm).
   */
  learn: boolean;
  /** Hide this specific job even if learn=false ("hide this only") */
  hideJob: boolean;
  createdAt: string;
}

/** Durable AI-synthesized search/match guidance from confirmed feedback. */
export interface FeedbackPreferenceState {
  userId: string;
  /** Human-readable bullets injected into search + match prompts */
  learnedConstraints: string[];
  /** One-paragraph strategy for the AI */
  guidanceSummary: string;
  /**
   * Soft ceiling on target seniority when user confirmed "too senior" style feedback.
   * Does not rewrite the career ladder — only biases search/match.
   */
  experienceCeiling?: ExperienceLevel;
  /** Job ids explicitly hidden by feedback */
  hiddenJobIds: string[];
  updatedAt: string;
}

/** AI review of a dislike before the user confirms learning. */
export interface FeedbackReviewResult {
  theme: FeedbackTheme;
  aiStance: FeedbackAiStance;
  aiExplanation: string;
  constraintSummary: string;
  proposedExperienceCeiling?: ExperienceLevel;
  userLikelyCorrect: boolean;
}

export type CoverLetterLanguage = "en" | "nl";

/** Auto-detect or force language for job-board keyword searches. */
export type JobSearchLanguageSetting = "auto" | CoverLetterLanguage;

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
