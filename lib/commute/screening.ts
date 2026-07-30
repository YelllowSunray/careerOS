import { hasCommuteLimit } from "@/lib/commute/helpers";
import { estimateCommuteMinutes, isLikelyRemoteJob } from "@/lib/commute/estimate";
import type { UserProfile } from "@/lib/types";

export interface CommuteScreeningInput {
  profile: Pick<UserProfile, "homeLocation" | "commuteMode" | "commuteMaxMinutes">;
  jobLocation?: string;
  postingText?: string;
  aiCommuteRequirementMet?: boolean;
  aiEstimatedCommuteMinutes?: number;
  aiCommuteNotes?: string;
}

export interface CommuteScreeningResult {
  commuteRequirementMet: boolean;
  commuteNotes: string;
  estimatedCommuteMinutes?: number;
}

export async function screenCommute(
  input: CommuteScreeningInput
): Promise<CommuteScreeningResult> {
  const { profile, jobLocation, postingText } = input;
  const max = profile.commuteMaxMinutes;
  const mode = profile.commuteMode;
  const home = profile.homeLocation?.trim();

  if (!hasCommuteLimit(profile)) {
    if (home && mode && max === null) {
      return {
        commuteRequirementMet: true,
        commuteNotes: "No commute time limit set.",
        estimatedCommuteMinutes: input.aiEstimatedCommuteMinutes,
      };
    }
    return {
      commuteRequirementMet: true,
      commuteNotes: input.aiCommuteNotes?.trim() || "Commute preference not configured.",
      estimatedCommuteMinutes: input.aiEstimatedCommuteMinutes,
    };
  }

  if (isLikelyRemoteJob(jobLocation, postingText)) {
    return {
      commuteRequirementMet: true,
      commuteNotes: "Role appears fully remote — commute limit not applied.",
      estimatedCommuteMinutes: 0,
    };
  }

  const dest = jobLocation?.trim();
  if (dest && home && mode && typeof max === "number") {
    const routed = await estimateCommuteMinutes(home, dest, mode);
    if (routed) {
      const met = routed.minutes <= max;
      return {
        commuteRequirementMet: met,
        estimatedCommuteMinutes: routed.minutes,
        commuteNotes: met
          ? `Estimated ${routed.minutes} min one-way by ${mode} (${routed.source}); within your ${max} min limit.`
          : `Estimated ${routed.minutes} min one-way by ${mode} (${routed.source}); exceeds your ${max} min limit.`,
      };
    }
  }

  const aiMet = input.aiCommuteRequirementMet;
  if (typeof aiMet === "boolean") {
    return {
      commuteRequirementMet: aiMet,
      commuteNotes:
        input.aiCommuteNotes?.trim() ||
        (aiMet
          ? `Within ${max} min ${mode} commute (AI estimate).`
          : `Likely exceeds ${max} min ${mode} commute (AI estimate).`),
      estimatedCommuteMinutes: input.aiEstimatedCommuteMinutes,
    };
  }

  return {
    commuteRequirementMet: true,
    commuteNotes:
      input.aiCommuteNotes?.trim() ||
      "Could not verify commute time — not rejected.",
    estimatedCommuteMinutes: input.aiEstimatedCommuteMinutes,
  };
}
