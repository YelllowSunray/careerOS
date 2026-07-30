import type { CoreCraftFit, GapLearnability, MissingSkill } from "@/lib/types";

export function normalizeCoreCraftFit(raw: unknown): CoreCraftFit | undefined {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");
  if (
    s === "day_one" ||
    s === "dayone" ||
    s === "ready" ||
    s === "yes_day_one"
  ) {
    return "day_one";
  }
  if (
    s === "with_ramp" ||
    s === "withramp" ||
    s === "ramp" ||
    s === "learn_on_job" ||
    s === "yes_with_ramp" ||
    s === "trainable"
  ) {
    return "with_ramp";
  }
  if (
    s === "not_eligible" ||
    s === "noteligible" ||
    s === "no" ||
    s === "wrong_craft" ||
    s === "ineligible"
  ) {
    return "not_eligible";
  }
  return undefined;
}

export function normalizeGapLearnability(
  raw: unknown,
  hardFallback?: boolean
): GapLearnability {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");
  if (
    s === "must_have" ||
    s === "musthave" ||
    s === "hard" ||
    s === "required" ||
    s === "non_negotiable"
  ) {
    return "must_have";
  }
  if (
    s === "learn_on_job" ||
    s === "learn_on_the_job" ||
    s === "learnable" ||
    s === "ramp" ||
    s === "trainable"
  ) {
    return "learn_on_job";
  }
  if (
    s === "nice_to_have" ||
    s === "nicetohave" ||
    s === "soft" ||
    s === "preferred" ||
    s === "optional"
  ) {
    return "nice_to_have";
  }
  if (hardFallback === true) return "must_have";
  if (hardFallback === false) return "nice_to_have";
  return "nice_to_have";
}

export function toMissingSkill(input: {
  skill: string;
  learnability?: unknown;
  isHardRequirement?: boolean;
}): MissingSkill | null {
  const skill = input.skill.trim();
  if (!skill) return null;
  const learnability = normalizeGapLearnability(
    input.learnability,
    input.isHardRequirement
  );
  return {
    skill,
    learnability,
    isHardRequirement: learnability === "must_have",
  };
}

/** Years / deep specialty gaps that cannot be ramped in ~90 days. */
export function looksLikeNonLearnableGap(skill: string): boolean {
  const s = skill.toLowerCase();
  if (
    /\b(\d+)\s*[-–to]+\s*(\d+)\+?\s*(years?|yrs?|jaar)\b/.test(s) ||
    /\b(\d+)\+?\s*(years?|yrs?|jaar)\b/.test(s)
  ) {
    return true;
  }
  if (
    /\b(license|licence|certification|certified|degree|diploma|credential|rijbewijs|registratie)\b/.test(
      s
    ) &&
    !/\b(nice|plus|preferred|voordeel)\b/.test(s)
  ) {
    return true;
  }
  // Named specialty craft that is the job, not a tool tip
  if (
    /\b(digital transformation|platform management|demand planning|s&op|sap implementation|wms program|international transport network)\b/.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

/** Tool / process gaps that are usually learn_on_job on the same craft. */
export function looksLikeRampableToolGap(skill: string): boolean {
  const s = skill.toLowerCase();
  if (looksLikeNonLearnableGap(s)) return false;
  return (
    /\b(wms|erp|excel|sap|oracle|salesforce|jira|confluence|powerpoint|tableau|power bi|crm|ats|slack|teams|agile|scrum|kanban)\b/.test(
      s
    ) ||
    /\b(tool|system|software|platform module|reporting)\b/.test(s)
  );
}

/** True when the candidate fails at least one must-have / hard gap. */
export function hasUnmetHardRequirements(
  missingSkills: MissingSkill[] | undefined
): boolean {
  return (missingSkills ?? []).some((s) => {
    if (!s.skill.trim()) return false;
    if (s.learnability === "must_have") return true;
    if (s.learnability === "learn_on_job" || s.learnability === "nice_to_have") {
      return false;
    }
    return Boolean(s.isHardRequirement);
  });
}

export function unmetHardRequirementLabels(
  missingSkills: MissingSkill[] | undefined
): string[] {
  return (missingSkills ?? [])
    .filter((s) => {
      if (!s.skill.trim()) return false;
      if (s.learnability === "must_have") return true;
      if (s.learnability === "learn_on_job" || s.learnability === "nice_to_have") {
        return false;
      }
      return Boolean(s.isHardRequirement);
    })
    .map((s) => s.skill.trim());
}

/**
 * AI eligibility gate:
 * - Prefer coreCraftFit when present (day_one / with_ramp keep; not_eligible hide)
 * - Else hide when skillRequirementMet is false or any must_have gap is unmet
 * - learn_on_job / nice_to_have never hide
 */
export function isSkillIneligible(match: {
  skillRequirementMet?: boolean;
  coreCraftFit?: CoreCraftFit;
  missingSkills?: MissingSkill[];
} | null | undefined): boolean {
  if (!match) return false;
  if (match.coreCraftFit === "not_eligible") return true;
  if (match.coreCraftFit === "day_one" || match.coreCraftFit === "with_ramp") {
    return false;
  }
  if (match.skillRequirementMet === false) return true;
  return hasUnmetHardRequirements(match.missingSkills);
}

export function isCommuteIneligible(match: {
  commuteRequirementMet?: boolean;
} | null | undefined): boolean {
  return match?.commuteRequirementMet === false;
}

export function isFeedbackIneligible(match: {
  feedbackRequirementMet?: boolean;
} | null | undefined): boolean {
  return match?.feedbackRequirementMet === false;
}

export function groupMissingSkillsByLearnability(
  missingSkills: MissingSkill[] | undefined
): {
  mustHave: MissingSkill[];
  learnOnJob: MissingSkill[];
  niceToHave: MissingSkill[];
} {
  const mustHave: MissingSkill[] = [];
  const learnOnJob: MissingSkill[] = [];
  const niceToHave: MissingSkill[] = [];
  for (const s of missingSkills ?? []) {
    if (!s.skill.trim()) continue;
    const bucket =
      s.learnability ??
      (s.isHardRequirement ? "must_have" : "nice_to_have");
    if (bucket === "must_have") mustHave.push(s);
    else if (bucket === "learn_on_job") learnOnJob.push(s);
    else niceToHave.push(s);
  }
  return { mustHave, learnOnJob, niceToHave };
}
