import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import { runIntakeChat } from "@/agents/tools/career-intake";
import {
  buildSkippedCareerIntent,
  seedTargetRolesFromStrategy,
} from "@/lib/job-search/career-intent";
import { defaultStrategyFromIntent } from "@/lib/job-search/strategy";
import { getProfile, saveProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { CareerIntent, SearchStrategy } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = (await request.json()) as {
      messages?: { role: "user" | "assistant"; content: string }[];
      action?: "chat" | "confirm" | "skip";
      careerIntent?: CareerIntent;
      searchStrategy?: SearchStrategy;
      language?: "nl" | "en";
    };

    const action = body.action ?? "chat";
    const existing = await getProfile(userId);
    if (!existing) return jsonError("Profile not found", 404);

    if (action === "skip") {
      const careerIntent = buildSkippedCareerIntent(existing);
      const searchStrategy = defaultStrategyFromIntent(careerIntent, "nl");
      const targetRoles = seedTargetRolesFromStrategy(
        searchStrategy,
        existing.targetRoles
      );
      const profile = {
        ...existing,
        careerIntent,
        searchStrategy,
        targetRoles,
        updatedAt: nowIso(),
      };
      await saveProfile(profile);
      return jsonOk({ profile, skipped: true });
    }

    if (action === "confirm") {
      const careerIntent = body.careerIntent;
      const searchStrategy = body.searchStrategy;
      if (!careerIntent || !searchStrategy) {
        return jsonError("careerIntent and searchStrategy required", 400);
      }
      const targetRoles = seedTargetRolesFromStrategy(
        searchStrategy,
        existing.targetRoles
      );
      const profile = {
        ...existing,
        careerIntent: { ...careerIntent, updatedAt: nowIso(), source: "intake" as const },
        searchStrategy: {
          ...searchStrategy,
          confirmedAt: nowIso(),
        },
        targetRoles,
        updatedAt: nowIso(),
      };
      await saveProfile(profile);
      return jsonOk({ profile, confirmed: true });
    }

    const context = await buildCandidateContext(userId);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const result = await runIntakeChat({
      context,
      messages,
      language: body.language === "en" ? "en" : "nl",
    });

    return jsonOk(result);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Intake chat]", e);
    return jsonError(
      e instanceof Error ? e.message : "Intake chat failed",
      500
    );
  }
}
