/**
 * In-process registry of find_jobs loops actually executing on this server.
 * Firestore can still say "running" after a restart; those are orphans.
 * Server-only — do not import from client components.
 * Note: useless across Vercel isolates — orphan detection is gated in stale.ts.
 */
const liveFindJobs = new Set<string>();

export function markFindJobsLive(workflowId: string): void {
  liveFindJobs.add(workflowId);
}

export function markFindJobsDone(workflowId: string): void {
  liveFindJobs.delete(workflowId);
}

export function isFindJobsLive(workflowId: string): boolean {
  return liveFindJobs.has(workflowId);
}
