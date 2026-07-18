import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type {
  UserProfile,
  ResumeData,
  CandidateProfile,
  Job,
  JobMatch,
  Application,
  Workflow,
  PortfolioSite,
} from "@/lib/types";

export const COLLECTIONS = {
  profiles: "profiles",
  resumes: "resumes",
  portfolioSites: "portfolioSites",
  candidateProfiles: "candidateProfiles",
  jobs: "jobs",
  jobMatches: "jobMatches",
  applications: "applications",
  workflows: "workflows",
} as const;

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.profiles, userId));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function getResume(userId: string): Promise<ResumeData | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.resumes, userId));
  return snap.exists() ? (snap.data() as ResumeData) : null;
}

export async function getCandidateProfile(
  userId: string
): Promise<CandidateProfile | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.candidateProfiles, userId));
  return snap.exists() ? (snap.data() as CandidateProfile) : null;
}

export async function getJobs(userId: string): Promise<Job[]> {
  const q = query(
    collection(db, COLLECTIONS.jobs),
    where("userId", "==", userId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as Job)
    .sort(
      (a, b) =>
        new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
    )
    .slice(0, 100);
}

export async function getJobMatches(userId: string): Promise<JobMatch[]> {
  const q = query(
    collection(db, COLLECTIONS.jobMatches),
    where("userId", "==", userId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as JobMatch)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 100);
}

export async function getApplications(userId: string): Promise<Application[]> {
  const q = query(
    collection(db, COLLECTIONS.applications),
    where("userId", "==", userId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as Application)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 100);
}

export async function getWorkflows(userId: string): Promise<Workflow[]> {
  const q = query(
    collection(db, COLLECTIONS.workflows),
    where("userId", "==", userId),
    orderBy("startedAt", "desc"),
    limit(20)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Workflow);
}

export async function getPortfolioSites(userId: string): Promise<PortfolioSite[]> {
  const q = query(
    collection(db, COLLECTIONS.portfolioSites),
    where("userId", "==", userId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PortfolioSite));
}
