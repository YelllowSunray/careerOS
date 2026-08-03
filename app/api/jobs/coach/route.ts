import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import { runJobsCoach } from "@/agents/tools/jobs-coach";
import { seedTargetRolesFromStrategy } from "@/lib/job-search/career-intent";
import { getLatestWorkflow, getProfile, saveProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { CareerIntent, SearchStrategy } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const context = await buildCandidateContext(userId);
    const workflow = await getLatestWorkflow(userId, "find_jobs");
    const roundsWithoutSave = Number(workflow?.config?.roundsWithoutSave ?? 0) || 0;
    const emptyFunnelActive = Boolean(workflow?.config?.emptyFunnelActive);

    if (!emptyFunnelActive && roundsWithoutSave < 2) {
      return jsonOk({
        active: false,
        roundsWithoutSave,
        emptyFunnelActive,
      });
    }

    const coach = await runJobsCoach({
      context,
      roundsWithoutSave,
    });

    return jsonOk({
      active: true,
      roundsWithoutSave,
      emptyFunnelActive,
      ...coach,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Jobs coach GET]", e);
    return jsonError(
      e instanceof Error ? e.message : "Coach failed",
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = (await request.json()) as {
      action?: "confirm" | "dismiss";
      searchStrategy?: SearchStrategy;
      careerIntent?: CareerIntent;
      intentPatch?: Partial<CareerIntent>;
    };
    const existing = await getProfile(userId);
    if (!existing) return jsonError("Profile not found", 404);

    if (body.action === "dismiss") {
      return jsonOk({ dismissed: true });
    }

    const searchStrategy = body.searchStrategy;
    if (!searchStrategy) {
      return jsonError("searchStrategy required", 400);
    }

    const baseIntent = body.careerIntent ?? existing.careerIntent;
    const patch = body.intentPatch ?? {};
    const careerIntent: CareerIntent = {
      northStar:
        patch.northStar?.trim() ||
        baseIntent?.northStar ||
        searchStrategy.dream[0] ||
        "Next role",
      narrative: patch.narrative?.trim() || baseIntent?.narrative || "",
      antiGoals: [
        ...new Set([
          ...(baseIntent?.antiGoals ?? []),
          ...(patch.antiGoals ?? []),
          ...searchStrategy.never,
        ]),
      ].slice(0, 12),
      workSetting: patch.workSetting ?? baseIntent?.workSetting ?? "flexible",
      horizon: baseIntent?.horizon ?? { now: [], sixMonths: [], twoYears: [] },
      stretchTolerance:
        patch.stretchTolerance ??
        baseIntent?.stretchTolerance ??
        "show_stretch",
      moneyFloor: baseIntent?.moneyFloor,
      nonNegotiables: baseIntent?.nonNegotiables ?? [],
      openQuestions: patch.openQuestions ?? baseIntent?.openQuestions ?? [],
      updatedAt: nowIso(),
      source: "coach",
    };

    const strategy: SearchStrategy = {
      ...searchStrategy,
      confirmedAt: nowIso(),
    };
    const targetRoles = seedTargetRolesFromStrategy(
      strategy,
      existing.targetRoles
    );

    const profile = {
      ...existing,
      careerIntent,
      searchStrategy: strategy,
      targetRoles,
      updatedAt: nowIso(),
    };
    await saveProfile(profile);

    // Reset empty-funnel counter on latest workflow if present.
    const workflow = await getLatestWorkflow(userId, "find_jobs");
    if (workflow) {
      const { updateWorkflow } = await import("@/services/firestore");
      await updateWorkflow(workflow.id, {
        config: {
          ...workflow.config,
          roundsWithoutSave: 0,
          emptyFunnelActive: false,
        },
      });
    }

    return jsonOk({ profile, confirmed: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Jobs coach POST]", e);
    return jsonError(
      e instanceof Error ? e.message : "Coach confirm failed",
      500
    );
  }
}
