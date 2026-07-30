import { getAdminFirestore } from "@/lib/firebase/admin";
import { sanitizeForFirestore } from "@/lib/firestore/sanitize";
import { jobIdentityKey } from "@/lib/job-search/identity";
import type { DocumentData } from "firebase-admin/firestore";
import type {
  UserProfile,
  ResumeData,
  CandidateProfile,
  Job,
  JobMatch,
  Application,
  Workflow,
  PortfolioSite,
  BrowserSession,
} from "@/lib/types";
import type { LinkedInProfileData } from "@/lib/types/integrations";

export const COLLECTIONS = {
  profiles: "profiles",
  resumes: "resumes",
  portfolioSites: "portfolioSites",
  candidateProfiles: "candidateProfiles",
  jobs: "jobs",
  jobMatches: "jobMatches",
  applications: "applications",
  workflows: "workflows",
  browserSessions: "browserSessions",
  linkedInProfiles: "linkedInProfiles",
  /** Persists evaluated listing keys across pause/restart until Clear Results. */
  jobSearchState: "jobSearchState",
} as const;

const db = () => getAdminFirestore();

function setDoc<T>(collection: string, id: string, data: T) {
  return db()
    .collection(collection)
    .doc(id)
    .set(sanitizeForFirestore(data) as DocumentData);
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await setDoc(COLLECTIONS.profiles, profile.userId, profile);
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const snap = await db().collection(COLLECTIONS.profiles).doc(userId).get();
  return snap.exists ? (snap.data() as UserProfile) : null;
}

export async function saveResume(data: ResumeData): Promise<void> {
  await setDoc(COLLECTIONS.resumes, data.userId, data);
}

export async function getResume(userId: string): Promise<ResumeData | null> {
  const snap = await db().collection(COLLECTIONS.resumes).doc(userId).get();
  return snap.exists ? (snap.data() as ResumeData) : null;
}

export async function deleteResume(userId: string): Promise<void> {
  await db().collection(COLLECTIONS.resumes).doc(userId).delete();
}

export async function deleteCandidateProfile(userId: string): Promise<void> {
  await db().collection(COLLECTIONS.candidateProfiles).doc(userId).delete();
}

export async function savePortfolioSite(site: PortfolioSite): Promise<void> {
  await setDoc(COLLECTIONS.portfolioSites, site.id, site);
}

export async function getPortfolioSites(userId: string): Promise<PortfolioSite[]> {
  const snap = await db()
    .collection(COLLECTIONS.portfolioSites)
    .where("userId", "==", userId)
    .get();
  return snap.docs.map((d) => d.data() as PortfolioSite);
}

export async function saveCandidateProfile(
  profile: CandidateProfile
): Promise<void> {
  await setDoc(COLLECTIONS.candidateProfiles, profile.userId, profile);
}

export async function getCandidateProfile(
  userId: string
): Promise<CandidateProfile | null> {
  const snap = await db()
    .collection(COLLECTIONS.candidateProfiles)
    .doc(userId)
    .get();
  return snap.exists ? (snap.data() as CandidateProfile) : null;
}

export async function saveJob(job: Job): Promise<void> {
  await setDoc(COLLECTIONS.jobs, job.id, job);
}

export async function getJob(id: string): Promise<Job | null> {
  const snap = await db().collection(COLLECTIONS.jobs).doc(id).get();
  return snap.exists ? (snap.data() as Job) : null;
}

export async function clearUserJobsAndMatches(userId: string): Promise<void> {
  const batch = db().batch();
  const [jobsSnap, matchesSnap] = await Promise.all([
    db().collection(COLLECTIONS.jobs).where("userId", "==", userId).get(),
    db().collection(COLLECTIONS.jobMatches).where("userId", "==", userId).get(),
  ]);
  jobsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  matchesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  if (!jobsSnap.empty || !matchesSnap.empty) {
    await batch.commit();
  }
}

/** Dev reset: jobs, matches, and draft/ready applications from job search. */
export async function clearUserJobSearchResults(userId: string): Promise<void> {
  const [jobsSnap, matchesSnap, appsSnap] = await Promise.all([
    db().collection(COLLECTIONS.jobs).where("userId", "==", userId).get(),
    db().collection(COLLECTIONS.jobMatches).where("userId", "==", userId).get(),
    db().collection(COLLECTIONS.applications).where("userId", "==", userId).get(),
  ]);

  const batch = db().batch();
  jobsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  matchesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  appsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  // Reset evaluated-listing memory so the next search may re-open rejects/accepts.
  batch.delete(db().collection(COLLECTIONS.jobSearchState).doc(userId));

  await batch.commit();
}

export interface JobSearchState {
  userId: string;
  /** Listing identity keys already matched or rejected — skip until Clear. */
  evaluatedListingKeys: string[];
  updatedAt: string;
}

export async function getJobSearchState(
  userId: string
): Promise<JobSearchState | null> {
  const snap = await db()
    .collection(COLLECTIONS.jobSearchState)
    .doc(userId)
    .get();
  return snap.exists ? (snap.data() as JobSearchState) : null;
}

export async function saveJobSearchState(
  state: JobSearchState
): Promise<void> {
  await setDoc(COLLECTIONS.jobSearchState, state.userId, state);
}

/** Merge newly decided listing keys into durable search memory (until Clear). */
export async function mergeEvaluatedListingKeys(
  userId: string,
  keys: string[]
): Promise<string[]> {
  if (keys.length === 0) {
    const existing = await getJobSearchState(userId);
    return existing?.evaluatedListingKeys ?? [];
  }
  const existing = await getJobSearchState(userId);
  const merged = [...(existing?.evaluatedListingKeys ?? [])];
  const seen = new Set(merged);
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  await saveJobSearchState({
    userId,
    evaluatedListingKeys: merged,
    updatedAt: new Date().toISOString(),
  });
  return merged;
}

export async function getJobs(userId: string): Promise<Job[]> {
  const snap = await db()
    .collection(COLLECTIONS.jobs)
    .where("userId", "==", userId)
    .get();
  return snap.docs
    .map((d) => d.data() as Job)
    .sort(
      (a, b) =>
        new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
    )
    .slice(0, 100);
}

export async function getKnownJobIdentityKeys(userId: string): Promise<Set<string>> {
  const snap = await db()
    .collection(COLLECTIONS.jobs)
    .where("userId", "==", userId)
    .get();
  return new Set(snap.docs.map((d) => jobIdentityKey(d.data() as Job)));
}

export async function saveJobMatch(match: JobMatch): Promise<void> {
  await setDoc(COLLECTIONS.jobMatches, match.id, match);
}

export async function getJobMatch(id: string): Promise<JobMatch | null> {
  const snap = await db().collection(COLLECTIONS.jobMatches).doc(id).get();
  return snap.exists ? (snap.data() as JobMatch) : null;
}

export async function getJobMatches(userId: string): Promise<JobMatch[]> {
  const snap = await db()
    .collection(COLLECTIONS.jobMatches)
    .where("userId", "==", userId)
    .get();
  return snap.docs
    .map((d) => d.data() as JobMatch)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 100);
}

export async function saveApplication(app: Application): Promise<void> {
  await setDoc(COLLECTIONS.applications, app.id, app);
}

export async function getApplication(id: string): Promise<Application | null> {
  const snap = await db().collection(COLLECTIONS.applications).doc(id).get();
  return snap.exists ? (snap.data() as Application) : null;
}

export async function getApplications(userId: string): Promise<Application[]> {
  const snap = await db()
    .collection(COLLECTIONS.applications)
    .where("userId", "==", userId)
    .get();
  return snap.docs
    .map((d) => d.data() as Application)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 100);
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  await setDoc(COLLECTIONS.workflows, workflow.id, workflow);
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const snap = await db().collection(COLLECTIONS.workflows).doc(id).get();
  return snap.exists ? (snap.data() as Workflow) : null;
}

export async function getLatestWorkflow(
  userId: string,
  type: Workflow["type"]
): Promise<Workflow | null> {
  const snap = await db()
    .collection(COLLECTIONS.workflows)
    .where("userId", "==", userId)
    .get();

  const latest = snap.docs
    .map((d) => d.data() as Workflow)
    .filter((w) => w.type === type)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];

  return latest ?? null;
}

export async function updateWorkflow(
  id: string,
  data: Partial<Workflow>
): Promise<void> {
  await db()
    .collection(COLLECTIONS.workflows)
    .doc(id)
    .update(sanitizeForFirestore(data) as DocumentData);
}

export async function saveBrowserSession(session: BrowserSession): Promise<void> {
  await setDoc(COLLECTIONS.browserSessions, session.id, session);
}

export async function getBrowserSession(
  id: string
): Promise<BrowserSession | null> {
  const snap = await db()
    .collection(COLLECTIONS.browserSessions)
    .doc(id)
    .get();
  return snap.exists ? (snap.data() as BrowserSession) : null;
}

export async function saveLinkedInProfile(
  profile: LinkedInProfileData
): Promise<void> {
  await setDoc(COLLECTIONS.linkedInProfiles, profile.userId, profile);
}

export async function getLinkedInProfile(
  userId: string
): Promise<LinkedInProfileData | null> {
  const snap = await db()
    .collection(COLLECTIONS.linkedInProfiles)
    .doc(userId)
    .get();
  return snap.exists ? (snap.data() as LinkedInProfileData) : null;
}
