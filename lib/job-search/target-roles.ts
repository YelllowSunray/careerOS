import type {
  TargetRoleSuggestion,
  TargetRolesPreference,
  UserProfile,
} from "@/lib/types";

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseTargetRolesBody(
  raw: unknown
): TargetRolesPreference | undefined {
  if (raw === null) return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const primary = String(o.primary ?? "").trim();
  const suggestedRaw = Array.isArray(o.suggested) ? o.suggested : [];
  const suggested: TargetRoleSuggestion[] = [];
  for (const item of suggestedRaw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const role = String(s.role ?? "").trim();
    if (!role) continue;
    const searchQuery =
      String(s.searchQuery ?? s.search_query ?? role).trim() || role;
    const relatedness =
      s.relatedness === "stretch" || s.relatedness === "adjacent"
        ? s.relatedness
        : "adjacent";
    const note = String(s.hireabilityNote ?? s.hireability_note ?? "").trim();
    suggested.push({
      role,
      searchQuery,
      relatedness,
      ...(note ? { hireabilityNote: note } : {}),
    });
  }

  const enabledRaw = Array.isArray(o.enabled) ? o.enabled : [];
  const enabled = [
    ...new Set(
      enabledRaw
        .map((e) => String(e).trim())
        .filter((e) => e.length > 0)
    ),
  ].slice(0, 3);

  const suggestedAt = String(o.suggestedAt ?? o.suggested_at ?? "").trim();

  if (!primary && suggested.length === 0 && enabled.length === 0) {
    return undefined;
  }

  return {
    primary,
    suggested,
    enabled,
    ...(suggestedAt ? { suggestedAt } : {}),
  };
}

/** Board-ready queries from checked target roles (max 3). */
export function getEnabledTargetSearchQueries(
  profile: Pick<UserProfile, "targetRoles">
): string[] {
  const tr = profile.targetRoles;
  if (!tr) return [];

  const enabledKeys = new Set(tr.enabled.map(normKey).filter(Boolean));
  if (enabledKeys.size === 0) return [];

  const byKey = new Map<string, string>();
  const primary = tr.primary.trim();
  if (primary) {
    byKey.set(normKey(primary), primary);
  }
  for (const s of tr.suggested) {
    const key = normKey(s.role);
    if (!key) continue;
    byKey.set(key, (s.searchQuery || s.role).trim());
  }

  const queries: string[] = [];
  const seen = new Set<string>();

  // Preserve enabled order as stored, but prefer primary first when present.
  const orderedKeys = [
    ...(primary && enabledKeys.has(normKey(primary))
      ? [normKey(primary)]
      : []),
    ...tr.enabled.map(normKey).filter((k) => k && k !== normKey(primary)),
  ];

  for (const key of orderedKeys) {
    if (!enabledKeys.has(key)) continue;
    const q = (byKey.get(key) || key).trim().toLowerCase();
    if (q.length < 3 || seen.has(q)) continue;
    seen.add(q);
    queries.push(q);
    if (queries.length >= 3) break;
  }

  return queries;
}

export function formatTargetRolesForPrompt(
  profile: Pick<UserProfile, "targetRoles">
): string {
  const tr = profile.targetRoles;
  if (!tr?.primary?.trim() && !(tr?.enabled?.length)) {
    return "";
  }
  const enabled = tr.enabled.length
    ? tr.enabled.join(", ")
    : "(none checked yet)";
  const notes = tr.suggested
    .filter((s) => s.hireabilityNote && tr.enabled.some((e) => normKey(e) === normKey(s.role)))
    .map((s) => `- ${s.role}: ${s.hireabilityNote}`)
    .join("\n");

  return `TARGET ROLES (user-selected — hard search drivers when enabled):
Primary: ${tr.primary.trim() || "(not set)"}
Enabled for search: ${enabled}
${notes ? `Hireability notes:\n${notes}` : ""}`;
}

/** Steep-jump warnings for currently enabled suggested roles. */
export function enabledHireabilityWarnings(
  targetRoles?: TargetRolesPreference | null
): string[] {
  if (!targetRoles) return [];
  const enabled = new Set(targetRoles.enabled.map(normKey));
  return targetRoles.suggested
    .filter(
      (s) =>
        s.hireabilityNote &&
        enabled.has(normKey(s.role))
    )
    .map((s) => `${s.role}: ${s.hireabilityNote}`);
}
