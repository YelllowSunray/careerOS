/** True when the candidate fails at least one non-negotiable posting requirement flag. */
export function hasUnmetHardRequirements(
  missingSkills: { skill: string; isHardRequirement: boolean }[] | undefined
): boolean {
  return (missingSkills ?? []).some((s) => s.isHardRequirement && s.skill.trim());
}

export function unmetHardRequirementLabels(
  missingSkills: { skill: string; isHardRequirement: boolean }[] | undefined
): string[] {
  return (missingSkills ?? [])
    .filter((s) => s.isHardRequirement && s.skill.trim())
    .map((s) => s.skill.trim());
}

/**
 * AI eligibility gate: hide/reject when skillRequirementMet is explicitly false,
 * or when any missing skill is flagged hard.
 */
export function isSkillIneligible(match: {
  skillRequirementMet?: boolean;
  missingSkills?: { skill: string; isHardRequirement: boolean }[];
} | null | undefined): boolean {
  if (!match) return false;
  if (match.skillRequirementMet === false) return true;
  return hasUnmetHardRequirements(match.missingSkills);
}
