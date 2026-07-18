import type { Workflow } from "@/lib/types";
import { isFindJobsLive } from "@/lib/workflows/live";

export const WORKFLOW_STALE_MS = 10 * 60 * 1000; // 10 minutes
/** Continuous job search may run for hours; only stale if idle this long. */
export const FIND_JOBS_IDLE_STALE_MS = 45 * 60 * 1000; // 45 minutes without activity

function activityTimestamp(workflow: Workflow): number {
  const raw = workflow.lastActivityAt ?? workflow.startedAt;
  return new Date(raw).getTime();
}

/** Firestore says running but this Node process is not executing the loop. */
export function isOrphanedFindJobs(workflow: Workflow | null): boolean {
  if (!workflow || workflow.type !== "find_jobs") return false;
  if (workflow.status !== "running") return false;
  return !isFindJobsLive(workflow.id);
}

export function isWorkflowStale(workflow: Workflow | null): boolean {
  if (!workflow || workflow.status !== "running") return false;
  const timeout =
    workflow.type === "find_jobs" ? FIND_JOBS_IDLE_STALE_MS : WORKFLOW_STALE_MS;
  return Date.now() - activityTimestamp(workflow) > timeout;
}

export function isWorkflowActive(workflow: Workflow | null): boolean {
  return workflow?.status === "running" && !isWorkflowStale(workflow);
}

export function isWorkflowPaused(workflow: Workflow | null): boolean {
  return workflow?.status === "paused";
}

export function logWorkflowToConsole(workflow: Workflow | null, label = "Workflow") {
  if (!workflow) return;

  if (workflow.status === "failed" || isWorkflowStale(workflow)) {
    console.error(`[Profile] ${label} failed:`, workflow.error ?? "Processing timed out");
    workflow.steps
      .filter((s) => s.status === "failed" && s.error)
      .forEach((s) => console.error(`[Profile] Step "${s.name}" failed:`, s.error));
  }
}
