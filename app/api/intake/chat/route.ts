import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import { runIntakeChat } from "@/agents/tools/career-intake";
import {
  buildCareerConversation,
  buildSkippedCareerIntent,
  parseCareerChatMessages,
  seedTargetRolesFromStrategy,
} from "@/lib/job-search/career-intent";
import { defaultStrategyFromIntent } from "@/lib/job-search/strategy";
import { getProfile, saveProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { CareerChatMessage, CareerIntent, SearchStrategy } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const existing = await getProfile(userId);
    if (!existing) return jsonError("Profile not found", 404);
    return jsonOk({
      careerConversation: existing.careerConversation ?? null,
      careerIntent: existing.careerIntent ?? null,
      searchStrategy: existing.searchStrategy ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Intake chat GET]", e);
    return jsonError(
      e instanceof Error ? e.message : "Failed to load conversation",
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = (await request.json()) as {
      messages?: { role: "user" | "assistant"; content: string }[];
      action?: "chat" | "confirm" | "skip" | "clear";
      careerIntent?: CareerIntent;
      searchStrategy?: SearchStrategy;
      language?: "nl" | "en";
    };

    const action = body.action ?? "chat";
    const existing = await getProfile(userId);
    if (!existing) return jsonError("Profile not found", 404);

    if (action === "clear") {
      const profile = {
        ...existing,
        careerConversation: undefined,
        updatedAt: nowIso(),
      };
      await saveProfile(profile);
      return jsonOk({ cleared: true });
    }

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
        careerConversation: existing.careerConversation
          ? {
              ...existing.careerConversation,
              awaitingConfirm: false,
              updatedAt: nowIso(),
            }
          : existing.careerConversation,
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
      const conversation = existing.careerConversation
        ? {
            ...existing.careerConversation,
            draftIntent: careerIntent,
            draftStrategy: {
              ...searchStrategy,
              confirmedAt: nowIso(),
            },
            awaitingConfirm: false,
            updatedAt: nowIso(),
          }
        : existing.careerConversation;
      const profile = {
        ...existing,
        careerIntent: {
          ...careerIntent,
          updatedAt: nowIso(),
          source: "intake" as const,
        },
        searchStrategy: {
          ...searchStrategy,
          confirmedAt: nowIso(),
        },
        targetRoles,
        careerConversation: conversation,
        updatedAt: nowIso(),
      };
      await saveProfile(profile);
      return jsonOk({ profile, confirmed: true });
    }

    const context = await buildCandidateContext(userId);
    const prior = parseCareerChatMessages(body.messages);
    const result = await runIntakeChat({
      context,
      messages: prior,
      language: body.language === "en" ? "en" : "nl",
    });

    const assistant: CareerChatMessage = {
      role: "assistant",
      content: result.assistantMessage,
      at: nowIso(),
    };
    const nextMessages = [...prior, assistant];
    const awaitingConfirm = Boolean(
      result.isComplete && result.careerIntent && result.searchStrategy
    );
    const careerConversation = buildCareerConversation({
      messages: nextMessages,
      ...(result.careerIntent ? { draftIntent: result.careerIntent } : {}),
      ...(result.searchStrategy
        ? { draftStrategy: result.searchStrategy }
        : {}),
      awaitingConfirm,
      previous: existing.careerConversation,
    });

    await saveProfile({
      ...existing,
      careerConversation,
      updatedAt: nowIso(),
    });

    return jsonOk({
      ...result,
      careerConversation,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Intake chat]", e);
    return jsonError(
      e instanceof Error ? e.message : "Intake chat failed",
      500
    );
  }
}
