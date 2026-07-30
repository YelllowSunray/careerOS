import type {
  CareerIntent,
  SearchStrategy,
  StretchTolerance,
  TargetRolesPreference,
  UserProfile,
  WorkSettingPreference,
} from "@/lib/types";

const WORK_SETTINGS = new Set<WorkSettingPreference>([
  "office",
  "hybrid",
  "floor",
  "flexible",
]);

const STRETCH = new Set<StretchTolerance>([
  "hireable_only",
  "show_stretch",
  "dream_aggressive",
]);

function stringList(raw: unknown, max = 12): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((x) => String(x ?? "").trim())
        .filter((x) => x.length > 0)
    ),
  ].slice(0, max);
}

export function parseCareerIntentBody(raw: unknown): CareerIntent | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const workSetting = String(o.workSetting ?? o.work_setting ?? "flexible")
    .toLowerCase()
    .trim() as WorkSettingPreference;
  const stretchTolerance = String(
    o.stretchTolerance ?? o.stretch_tolerance ?? "show_stretch"
  )
    .toLowerCase()
    .trim() as StretchTolerance;
  const sourceRaw = String(o.source ?? "manual").toLowerCase().trim();
  const source =
    sourceRaw === "intake" ||
    sourceRaw === "coach" ||
    sourceRaw === "skip" ||
    sourceRaw === "manual"
      ? sourceRaw
      : "manual";

  const horizonRaw =
    o.horizon && typeof o.horizon === "object"
      ? (o.horizon as Record<string, unknown>)
      : {};

  return {
    northStar: String(o.northStar ?? o.north_star ?? "").trim(),
    narrative: String(o.narrative ?? "").trim(),
    antiGoals: stringList(o.antiGoals ?? o.anti_goals),
    workSetting: WORK_SETTINGS.has(workSetting) ? workSetting : "flexible",
    horizon: {
      now: stringList(horizonRaw.now),
      sixMonths: stringList(horizonRaw.sixMonths ?? horizonRaw.six_months),
      twoYears: stringList(horizonRaw.twoYears ?? horizonRaw.two_years),
    },
    stretchTolerance: STRETCH.has(stretchTolerance)
      ? stretchTolerance
      : "show_stretch",
    moneyFloor: String(o.moneyFloor ?? o.money_floor ?? "").trim() || undefined,
    nonNegotiables: stringList(o.nonNegotiables ?? o.non_negotiables),
    openQuestions: stringList(o.openQuestions ?? o.open_questions),
    updatedAt: String(o.updatedAt ?? o.updated_at ?? new Date().toISOString()),
    source,
  };
}

export function parseSearchStrategyBody(
  raw: unknown
): SearchStrategy | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    dream: stringList(o.dream, 6),
    bridge: stringList(o.bridge, 8),
    never: stringList(o.never, 12),
    confirmedAt: String(
      o.confirmedAt ?? o.confirmed_at ?? new Date().toISOString()
    ),
  };
}

/** Minimal intent when user skips conversational intake. */
export function buildSkippedCareerIntent(
  profile: Pick<UserProfile, "jobPreferences" | "targetRoles">
): CareerIntent {
  const primary = profile.targetRoles?.primary?.trim();
  const prefs = profile.jobPreferences?.trim();
  return {
    northStar: primary || prefs?.slice(0, 120) || "Find a better-fitting next role",
    narrative: prefs || "Skipped detailed intake — using form preferences.",
    antiGoals: [],
    workSetting: "flexible",
    horizon: {
      now: primary ? [primary] : [],
      sixMonths: [],
      twoYears: [],
    },
    stretchTolerance: "show_stretch",
    nonNegotiables: [],
    openQuestions: ["What would make the next role feel like progress?"],
    updatedAt: new Date().toISOString(),
    source: "skip",
  };
}

export function formatCareerIntentForPrompt(
  profile: Pick<UserProfile, "careerIntent" | "searchStrategy" | "targetRoles">
): string {
  const intent = profile.careerIntent;
  const strategy = profile.searchStrategy;
  if (!intent && !strategy) return "";

  const parts: string[] = [];
  if (intent) {
    parts.push(`CAREER INTENT (north star — prefer over inferred floor titles when they conflict):
North star: ${intent.northStar || "(unset)"}
Narrative: ${intent.narrative || "(unset)"}
Work setting: ${intent.workSetting}
Stretch tolerance: ${intent.stretchTolerance}
Anti-goals: ${intent.antiGoals.join("; ") || "(none)"}
Non-negotiables: ${intent.nonNegotiables.join("; ") || "(none)"}
Now: ${intent.horizon.now.join(", ") || "—"}
6–12 months: ${intent.horizon.sixMonths.join(", ") || "—"}
~2 years: ${intent.horizon.twoYears.join(", ") || "—"}
${intent.moneyFloor ? `Money floor: ${intent.moneyFloor}` : ""}`);
  }
  if (strategy) {
    parts.push(`SEARCH STRATEGY (confirmed lanes):
Dream: ${strategy.dream.join(", ") || "(none)"}
Bridge: ${strategy.bridge.join(", ") || "(none)"}
Never: ${strategy.never.join(", ") || "(none)"}`);
  }
  return parts.join("\n\n");
}

export function showStretchTargetsEnabled(
  profile: Pick<UserProfile, "settings" | "careerIntent">
): boolean {
  if (profile.settings.showStretchTargets === false) return false;
  const tol = profile.careerIntent?.stretchTolerance;
  if (tol === "hireable_only") return false;
  return true;
}

export function seedTargetRolesFromStrategy(
  strategy: SearchStrategy,
  existing?: TargetRolesPreference
): TargetRolesPreference {
  const dream = strategy.dream.map((d) => d.trim()).filter(Boolean);
  const bridge = strategy.bridge.map((b) => b.trim()).filter(Boolean);
  const primary = dream[0] || existing?.primary || "";
  const enabled = dream.slice(0, 3);
  const suggested = [
    ...dream.slice(1),
    ...bridge,
  ]
    .filter((r) => r.toLowerCase() !== primary.toLowerCase())
    .slice(0, 5)
    .map((role) => ({
      role,
      searchQuery: role.toLowerCase(),
      relatedness: "adjacent" as const,
    }));

  return {
    primary,
    suggested,
    enabled: enabled.length > 0 ? enabled : existing?.enabled ?? [],
    suggestedAt: new Date().toISOString(),
  };
}
