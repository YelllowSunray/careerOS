import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import { getProfile, saveProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { UserProfile } from "@/lib/types";
import {
  normalizeWorkPreferences,
  parseWorkPreferencesBody,
} from "@/lib/job-search/work-preference";

const COMMUTE_MODES = new Set(["car", "bike", "public_transit", "walk"]);

function parseCommuteMode(raw: unknown): UserProfile["commuteMode"] | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  return COMMUTE_MODES.has(s) ? (s as UserProfile["commuteMode"]) : undefined;
}

function withNormalizedWorkPreferences(
  profile: UserProfile | null
): UserProfile | null {
  if (!profile) return null;
  return {
    ...profile,
    workPreferences: normalizeWorkPreferences(profile),
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const profile = await getProfile(userId);
    return jsonOk(withNormalizedWorkPreferences(profile));
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    const message = e instanceof Error ? e.message : "Failed to fetch profile";
    console.error("[Profile GET]", e);
    return jsonError(message, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);
    const body = await request.json();
    const existing = await getProfile(userId);

    const workPreferences =
      body.workPreferences !== undefined
        ? parseWorkPreferencesBody(body.workPreferences)
        : body.workPreference !== undefined
          ? parseWorkPreferencesBody(body.workPreference)
          : normalizeWorkPreferences(existing ?? {});

    const profile: UserProfile = {
      userId,
      name: body.name ?? existing?.name ?? "",
      email: body.email ?? existing?.email ?? "",
      phoneNumber:
        body.phoneNumber !== undefined
          ? String(body.phoneNumber).trim() || undefined
          : existing?.phoneNumber,
      linkedInUrl:
        body.linkedInUrl !== undefined
          ? String(body.linkedInUrl).trim() || undefined
          : existing?.linkedInUrl,
      githubUrl:
        body.githubUrl !== undefined
          ? String(body.githubUrl).trim() || undefined
          : existing?.githubUrl,
      portfolioUrls: body.portfolioUrls ?? existing?.portfolioUrls ?? [],
      preferredCountries: (
        body.preferredCountries ?? existing?.preferredCountries ?? []
      ).slice(0, 1),
      workPreferences,
      jobPreferences:
        body.jobPreferences !== undefined
          ? String(body.jobPreferences).trim() || undefined
          : existing?.jobPreferences,
      languagesSpoken: Array.isArray(body.languagesSpoken)
        ? [
            ...new Set(
              (body.languagesSpoken as unknown[])
                .map((l) => String(l).trim())
                .filter((l) => l.length > 0)
            ),
          ]
        : (existing?.languagesSpoken ?? []),
      homeLocation:
        body.homeLocation !== undefined
          ? String(body.homeLocation).trim() || undefined
          : existing?.homeLocation,
      commuteMode:
        body.commuteMode !== undefined
          ? parseCommuteMode(body.commuteMode)
          : existing?.commuteMode,
      commuteMaxMinutes:
        body.commuteMaxMinutes !== undefined
          ? body.commuteMaxMinutes === null
            ? null
            : Number.isFinite(Number(body.commuteMaxMinutes)) &&
                Number(body.commuteMaxMinutes) > 0
              ? Math.round(Number(body.commuteMaxMinutes))
              : undefined
          : existing?.commuteMaxMinutes,
      resume: body.resume ?? existing?.resume,
      coverLetters: body.coverLetters ?? existing?.coverLetters ?? [],
      onboardingComplete:
        body.onboardingComplete ?? existing?.onboardingComplete ?? false,
      settings: body.settings ??
        existing?.settings ?? {
          fitScoreThreshold: 85,
          autoApply: false,
          jobBoards: ["linkedin", "indeed"],
          playwrightJobSearchUrls: [],
          careerPageUrls: [],
        },
      updatedAt: nowIso(),
    };

    await saveProfile(profile);
    return jsonOk(profile);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    const message = e instanceof Error ? e.message : "Failed to save profile";
    console.error("Profile save error:", e);
    return jsonError(message, 500);
  }
}
