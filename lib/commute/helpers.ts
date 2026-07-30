import type { CommuteMode, UserProfile } from "@/lib/types";

export const COMMUTE_MODE_LABELS: Record<CommuteMode, string> = {
  car: "Car",
  bike: "Bike",
  public_transit: "Public transport",
  walk: "Walking",
};

export function commuteModeLabel(mode?: CommuteMode): string {
  if (!mode) return "—";
  return COMMUTE_MODE_LABELS[mode] ?? mode;
}

/** True when profile has home + mode and a numeric max > 0, or home-base-only (max 0). */
export function hasCommuteLimit(profile: Pick<
  UserProfile,
  "homeLocation" | "commuteMode" | "commuteMaxMinutes"
>): boolean {
  const home = profile.homeLocation?.trim();
  const mode = profile.commuteMode;
  const max = profile.commuteMaxMinutes;
  if (!home || typeof max !== "number" || max < 0) return false;
  // Home-base only does not require a commute mode.
  if (max === 0) return true;
  return Boolean(mode);
}

export function isHomeBaseOnly(
  profile: Pick<UserProfile, "homeLocation" | "commuteMaxMinutes">
): boolean {
  return Boolean(
    profile.homeLocation?.trim() && profile.commuteMaxMinutes === 0
  );
}

/** Primary place token from a home/job location string (text before first comma). */
export function primaryPlaceToken(location: string): string {
  return location.trim().split(",")[0]?.trim().toLowerCase() ?? "";
}

/**
 * True when the job's stated location is the candidate's home-base city/place
 * (not merely the same country or "remote").
 */
export function isJobInHomebase(
  homeLocation: string,
  jobLocation?: string
): boolean {
  const home = homeLocation.trim();
  const dest = (jobLocation ?? "").trim();
  if (!home || !dest) return false;

  const homeCity = primaryPlaceToken(home);
  if (homeCity.length < 2) return false;

  const destLower = dest.toLowerCase();
  // Country-only / vague regions do not count as home base.
  if (
    /^(remote|anywhere|distributed|netherlands|nederland|europe|eu|worldwide|global)(\b|$)/i.test(
      destLower
    )
  ) {
    return false;
  }

  // Require the home city as its own token in the job location.
  const escaped = homeCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(dest);
}

export function formatCommuteForPrompt(
  profile: Pick<UserProfile, "homeLocation" | "commuteMode" | "commuteMaxMinutes">
): string {
  const home = profile.homeLocation?.trim();
  const mode = profile.commuteMode;
  const max = profile.commuteMaxMinutes;

  if (!home) {
    return "COMMUTE PREFERENCE: (not set — do not hard-reject on commute)";
  }

  if (max === 0) {
    return `CANDIDATE COMMUTE (HARD gate — HOME BASE ONLY):
Home base: ${home}
Only roles located in the home-base city (${home}). Reject other cities, country-only ("Netherlands"), and remote/WFA.
commuteRequirementMet=true ONLY on home-base city match; estimatedCommuteMinutes=0 when matched.`;
  }

  if (!mode) {
    return "COMMUTE PREFERENCE: (home set but mode/limit incomplete — do not hard-reject on commute)";
  }

  const limitLine =
    max === null
      ? "Max one-way commute: no limit (commuteRequirementMet=true for commute reasons)"
      : typeof max === "number" && max > 0
        ? `Max one-way commute: ${max} minutes by ${commuteModeLabel(mode)}`
        : "Max one-way commute: not set (informational only)";

  return `CANDIDATE COMMUTE (HARD gate only when max minutes is set):
Home base: ${home}
Typical mode: ${commuteModeLabel(mode)}
${limitLine}

Rules:
- When max minutes > 0: commuteRequirementMet=false if the role requires regular on-site/hybrid attendance AND typical one-way commute by that mode clearly exceeds the max (use city/region in posting; be conservative for cross-country or far cities). Full remote / work-from-anywhere → commuteRequirementMet=true.
- When max is "no limit" (null) → commuteRequirementMet=true for commute reasons.
- If office location is vague and max > 0, use best judgment; only fail when clearly over the limit.
- estimatedCommuteMinutes: your best one-way estimate in minutes when you can infer office location (omit if unknown).`;
}

export function parseCommuteMaxMinutesFromForm(
  raw: string,
  noLimit: boolean,
  homeBaseOnly = false
): number | null | undefined {
  if (homeBaseOnly) return 0;
  if (noLimit) return null;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function commuteMaxMinutesToForm(
  value: number | null | undefined
): { noLimit: boolean; homeBaseOnly: boolean; minutes: string } {
  if (value === null) return { noLimit: true, homeBaseOnly: false, minutes: "" };
  if (value === 0) return { noLimit: false, homeBaseOnly: true, minutes: "" };
  if (typeof value === "number" && value > 0) {
    return { noLimit: false, homeBaseOnly: false, minutes: String(value) };
  }
  return { noLimit: false, homeBaseOnly: false, minutes: "" };
}

/** One-line commute status for a job card vs profile preference. */
export function formatCommuteMatchLine(
  match: {
    commuteRequirementMet?: boolean;
    commuteNotes?: string;
    estimatedCommuteMinutes?: number;
  } | null | undefined,
  profile: Pick<
    UserProfile,
    "homeLocation" | "commuteMode" | "commuteMaxMinutes"
  > | null | undefined
): { text: string; tone: "ok" | "fail" | "info" } | null {
  if (!match) return null;

  const home = profile?.homeLocation?.trim();
  const mode = profile?.commuteMode;
  const max = profile?.commuteMaxMinutes;
  const minutes = match.estimatedCommuteMinutes;
  const notes = match.commuteNotes?.trim();
  const met = match.commuteRequirementMet;

  const modeLabel = mode ? commuteModeLabel(mode).toLowerCase() : null;
  const homebaseOnly = Boolean(home && max === 0);
  const hasLimit = Boolean(home && mode && typeof max === "number" && max > 0);
  const noLimit = Boolean(home && mode && max === null);

  if (homebaseOnly) {
    if (met === false) {
      return {
        text:
          notes ||
          `Not in your home base (${home}) — home-base-only search`,
        tone: "fail",
      };
    }
    if (met === true) {
      return {
        text: notes || `In your home base (${home})`,
        tone: "ok",
      };
    }
  }

  if (minutes === 0 || /remote|work from home|fully remote/i.test(notes ?? "")) {
    return {
      text:
        notes && /remote/i.test(notes)
          ? notes
          : "Remote — commute limit does not apply",
      tone: "ok",
    };
  }

  if (typeof minutes === "number" && minutes > 0) {
    const timePart = modeLabel
      ? `~${minutes} min one-way by ${modeLabel}`
      : `~${minutes} min one-way`;

    if (hasLimit) {
      if (met === false) {
        return {
          text: `${timePart} — over your ${max} min limit from ${home}`,
          tone: "fail",
        };
      }
      return {
        text: `${timePart} — within your ${max} min limit from ${home}`,
        tone: "ok",
      };
    }

    if (noLimit) {
      return {
        text: `${timePart} from ${home} (no max set)`,
        tone: "info",
      };
    }

    return {
      text: notes ? `${timePart}. ${notes}` : timePart,
      tone: met === false ? "fail" : "info",
    };
  }

  // No minute estimate — still surface requirement outcome when configured.
  if (hasLimit) {
    if (met === false) {
      return {
        text:
          notes ||
          `Likely over your ${max} min ${modeLabel} commute from ${home}`,
        tone: "fail",
      };
    }
    if (met === true) {
      return {
        text:
          notes ||
          `Fits your ${max} min ${modeLabel} commute from ${home}`,
        tone: "ok",
      };
    }
  }

  if (notes) {
    return {
      text: notes,
      tone: met === false ? "fail" : "info",
    };
  }

  if (!home || (!mode && max !== 0)) {
    return {
      text: "Commute not configured on profile",
      tone: "info",
    };
  }

  return null;
}

