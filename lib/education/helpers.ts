import type {
  EducationRecommendation,
  MissingSkill,
} from "@/lib/types";

/** Pick education recs that close gaps on this match (AI titles may not match exactly). */
export function recommendationsForMatchGaps(
  recommendations: EducationRecommendation[] | undefined,
  missingSkills: MissingSkill[] | undefined,
  limit = 3
): EducationRecommendation[] {
  if (!recommendations?.length) return [];
  const gapText = (missingSkills ?? [])
    .map((s) => s.skill.toLowerCase())
    .join(" | ");
  if (!gapText) {
    return recommendations
      .filter((r) => r.horizon === "near")
      .slice(0, limit);
  }

  const scored = recommendations.map((r) => {
    let score = 0;
    for (const g of r.closesGaps) {
      const gLower = g.toLowerCase();
      if (gapText.includes(gLower) || gLower.split(/\s+/).some((w) => w.length > 3 && gapText.includes(w))) {
        score += 2;
      }
    }
    if (r.evidenceSources.includes("market")) score += 1;
    if (r.horizon === "near") score += 1;
    return { r, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.r.priority - b.r.priority)
    .slice(0, limit)
    .map((s) => s.r);
}

export function evidenceLabel(
  sources: EducationRecommendation["evidenceSources"]
): string {
  const labels: Record<string, string> = {
    market: "from jobs found",
    ladder: "ladder",
    profile: "profile",
    knowledge: "industry knowledge",
  };
  return sources.map((s) => labels[s] ?? s).join(" · ");
}
