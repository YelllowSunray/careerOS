import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { buildCandidateContext } from "@/lib/candidate/context";
import { suggestTargetRoles } from "@/agents/tools/suggest-target-roles";
import { getProfile, saveProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { TargetRolesPreference } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI suggests related roles for the candidate's primary target; persists on profile. */
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = (await request.json()) as { primary?: string };
    const primary = String(body.primary ?? "").trim();
    if (!primary) {
      return jsonError("primary role is required", 400);
    }

    const [context, existing] = await Promise.all([
      buildCandidateContext(userId),
      getProfile(userId),
    ]);
    if (!existing) {
      return jsonError("Profile not found", 404);
    }

    const suggestions = await suggestTargetRoles({ context, primary });

    const prevEnabled = existing.targetRoles?.enabled ?? [];
    // Keep primary enabled; drop stale suggestion enables that are no longer present.
    const suggestionTitles = new Set(
      suggestions.map((s) => s.role.trim().toLowerCase())
    );
    const enabled = [
      ...new Set([
        primary,
        ...prevEnabled.filter((e) => {
          const k = e.trim().toLowerCase();
          return k === primary.toLowerCase() || suggestionTitles.has(k);
        }),
      ]),
    ].slice(0, 3);

    const targetRoles: TargetRolesPreference = {
      primary,
      suggested: suggestions,
      enabled,
      suggestedAt: nowIso(),
    };

    const profile = {
      ...existing,
      targetRoles,
      updatedAt: nowIso(),
    };
    await saveProfile(profile);

    return jsonOk({ targetRoles, suggestions });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Suggest target roles]", e);
    return jsonError(
      e instanceof Error ? e.message : "Failed to suggest target roles",
      500
    );
  }
}
