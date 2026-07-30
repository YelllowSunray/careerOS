import type { WorkArrangement, WorkPreference } from "@/lib/types";

export const WORK_ARRANGEMENTS: WorkArrangement[] = [
  "remote",
  "hybrid",
  "onsite",
];

export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

function isWorkArrangement(value: unknown): value is WorkArrangement {
  return (
    value === "remote" || value === "hybrid" || value === "onsite"
  );
}

/**
 * Normalize profile work preferences from new array field or legacy single string.
 * Empty array = open to any arrangement.
 */
export function normalizeWorkPreferences(input: {
  workPreferences?: unknown;
  workPreference?: unknown;
}): WorkArrangement[] {
  if (Array.isArray(input.workPreferences)) {
    const seen = new Set<WorkArrangement>();
    const out: WorkArrangement[] = [];
    for (const item of input.workPreferences) {
      if (isWorkArrangement(item) && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  }

  const single = input.workPreference;
  if (single === "any" || single === "" || single == null) return [];
  if (isWorkArrangement(single)) return [single];
  if (Array.isArray(single)) {
    return normalizeWorkPreferences({ workPreferences: single });
  }
  return [];
}

/** Parse API / form body into a clean arrangements list. */
export function parseWorkPreferencesBody(raw: unknown): WorkArrangement[] {
  if (raw === "any" || raw === null || raw === undefined) return [];
  if (typeof raw === "string") {
    if (raw === "any") return [];
    if (isWorkArrangement(raw)) return [raw];
    return [];
  }
  if (Array.isArray(raw)) {
    return normalizeWorkPreferences({ workPreferences: raw });
  }
  return [];
}

export function formatWorkPreferences(
  prefs: WorkArrangement[] | undefined
): string {
  const list = prefs ?? [];
  if (list.length === 0) return "Any (remote, hybrid, or on-site)";
  return list.map((p) => WORK_ARRANGEMENT_LABELS[p]).join(", ");
}

/** True when the candidate only wants remote (board remote filter applies). */
export function isRemoteOnly(prefs: WorkArrangement[]): boolean {
  return prefs.length === 1 && prefs[0] === "remote";
}

export function includesWorkArrangement(
  prefs: WorkArrangement[],
  arrangement: WorkArrangement
): boolean {
  if (prefs.length === 0) return true;
  return prefs.includes(arrangement);
}

/**
 * Value used by board URL helpers that still expect a single string.
 * "remote" only when exclusively remote; otherwise "any".
 */
export function workPreferencesToSearchHint(
  prefs: WorkArrangement[]
): WorkPreference {
  if (isRemoteOnly(prefs)) return "remote";
  if (prefs.length === 1) return prefs[0];
  return "any";
}

export function toggleWorkArrangement(
  current: WorkArrangement[],
  arrangement: WorkArrangement
): WorkArrangement[] {
  if (current.includes(arrangement)) {
    return current.filter((p) => p !== arrangement);
  }
  return [...current, arrangement];
}
