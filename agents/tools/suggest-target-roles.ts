import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import {
  formatCareerLadderForPrompt,
  formatContextForPrompt,
} from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { TargetRoleSuggestion } from "@/lib/types";

const suggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        role: z.string(),
        searchQuery: z.string(),
        relatedness: z.enum(["adjacent", "stretch"]),
        hireabilityNote: z.string().optional(),
      })
    )
    .min(2)
    .max(5),
});

function normalizeSuggestions(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const list = o.suggestions ?? o.relatedRoles ?? o.roles ?? o.related;
  if (!Array.isArray(list)) return { suggestions: [] };
  return {
    suggestions: list.map((item) => {
      if (typeof item === "string") {
        return {
          role: item,
          searchQuery: item,
          relatedness: "adjacent",
        };
      }
      if (!item || typeof item !== "object") return null;
      const s = item as Record<string, unknown>;
      const role = String(s.role ?? s.title ?? s.name ?? "").trim();
      if (!role) return null;
      return {
        role,
        searchQuery: String(
          s.searchQuery ?? s.search_query ?? s.query ?? role
        ).trim(),
        relatedness:
          s.relatedness === "stretch" || s.relatedness === "adjacent"
            ? s.relatedness
            : "adjacent",
        hireabilityNote: String(
          s.hireabilityNote ?? s.hireability_note ?? s.warning ?? ""
        ).trim() || undefined,
      };
    }).filter(Boolean),
  };
}

/** Suggest related searchable roles for a primary target the candidate typed. */
export async function suggestTargetRoles(input: {
  context: CandidateContext;
  primary: string;
}): Promise<TargetRoleSuggestion[]> {
  const primary = input.primary.trim();
  if (!primary) return [];

  const ladderBlock = formatCareerLadderForPrompt(input.context);
  const candidateBlock = formatContextForPrompt(input.context, 10000);

  const result = await generateStructured(
    `The candidate wants to search for this PRIMARY target role: "${primary}"

Suggest 3–5 RELATED job titles they might also want to search (same craft family or mild adjacent).
Include the primary specialty if they named it; also include close variants boards use.

Rules:
- searchQuery: 2–5 word LinkedIn/Indeed keyword phrase (match the language of the primary when possible).
- relatedness: "adjacent" for same-family variants; "stretch" for a bigger scope step.
- hireabilityNote: OPTIONAL short warning (max 140 chars) ONLY when the CV evidence for that title looks thin (craft jump). Omit when hireable-now is plausible.
- Do NOT invent unrelated careers. Stay near logistics/ops/planning/etc. as implied by the primary + profile.
- Prefer titles an employer in their market would actually post.

${ladderBlock || ""}

Return JSON:
{
  "suggestions": [
    { "role": "Logistiek Planner", "searchQuery": "logistiek planner", "relatedness": "adjacent", "hireabilityNote": "CV is warehouse floor — planning craft may be a stretch." },
    { "role": "Planner Magazijn", "searchQuery": "planner magazijn", "relatedness": "adjacent" }
  ]
}

CANDIDATE:
${candidateBlock}`,
    suggestionSchema,
    {
      userId: input.context.userId,
      operation: "suggest_target_roles",
      coerce: normalizeSuggestions,
    }
  );

  const primaryKey = primary.toLowerCase();
  return result.suggestions
    .map((s) => ({
      role: s.role.trim(),
      searchQuery: (s.searchQuery || s.role).trim(),
      relatedness: s.relatedness,
      ...(s.hireabilityNote?.trim()
        ? { hireabilityNote: s.hireabilityNote.trim() }
        : {}),
    }))
    .filter((s) => s.role.length >= 2)
    .filter((s) => s.role.toLowerCase() !== primaryKey)
    .slice(0, 5);
}
