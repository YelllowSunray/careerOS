import { getWorkflow, updateWorkflow } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { Workflow, WorkflowStep } from "@/lib/types";

export class WorkflowPausedError extends Error {
  constructor() {
    super("Workflow paused");
    this.name = "WorkflowPausedError";
  }
}

export async function isWorkflowPaused(workflowId: string): Promise<boolean> {
  const workflow = await getWorkflow(workflowId);
  return workflow?.status === "paused";
}

/** True when find_jobs should exit (paused, failed, completed, or missing). */
export async function isFindJobsStopped(workflowId: string): Promise<boolean> {
  const workflow = await getWorkflow(workflowId);
  return !workflow || workflow.status !== "running";
}

export async function pauseWorkflow(workflowId: string): Promise<Workflow | null> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow || workflow.status !== "running") return workflow;

  const steps: WorkflowStep[] = workflow.steps.map((step) => {
    if (step.status === "running") {
      return { ...step, status: "failed", completedAt: nowIso(), error: "Paused" };
    }
    if (step.status === "pending") {
      return { ...step, status: "failed", completedAt: nowIso(), error: "Skipped — paused" };
    }
    return step;
  });

  await updateWorkflow(workflowId, {
    status: "paused",
    steps,
    completedAt: nowIso(),
  });

  return { ...workflow, status: "paused", steps, completedAt: nowIso() };
}
