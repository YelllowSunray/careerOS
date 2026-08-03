import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import {
  formatCareerLadderForPrompt,
  formatContextForPrompt,
  getLadderSearchQueriesFromContext,
  getTopInferredRolesFromContext,
} from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type { ExperienceLevel } from "@/lib/types";
import {
  guessQueryLanguage,
  type ResolvedJobSearchLanguage,
  type SearchQueryPlan,
} from "@/lib/job-search/locale";
import {
  getDreamQueries,
  getLaneQueries,
  resolveNeverList,
  synthesizeBridgeFromIntent,
} from "@/lib/job-search/strategy";
import { getEnabledTargetSearchQueries } from "@/lib/job-search/target-roles";
import { formatCareerIntentForPrompt } from "@/lib/job-search/career-intent";
import { ETHOS_AGENT_BLOCK } from "@/lib/career/ethos";

const intentQuerySchema = z.object({
  searchQueries: z
    .array(
      z.object({
        query: z.string(),
        language: z.enum(["nl", "en"]),
        lane: z.enum(["dream", "bridge"]),
        rationale: z.string().optional(),
      })
    )
    .min(2)
    .max(4),
  rationale: z.string(),
});

function coerceIntentQueries(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const list = o.searchQueries ?? o.queries ?? o.search_queries;
  if (!Array.isArray(list)) return { searchQueries: [], rationale: "" };
  return {
    rationale: String(o.rationale ?? o.summary ?? ""),
    searchQueries: list
      .map((item) => {
        if (typeof item === "string") {
          return {
            query: item,
            language: guessQueryLanguage(item),
            lane: "bridge",
          };
        }
        if (!item || typeof item !== "object") return null;
        const s = item as Record<string, unknown>;
        const query = String(s.query ?? s.q ?? s.title ?? "").trim();
        if (!query) return null;
        const langRaw = String(s.language ?? s.lang ?? "").toLowerCase();
        const language =
          langRaw === "nl" || langRaw === "en"
            ? langRaw
            : guessQueryLanguage(query);
        const lane =
          s.lane === "dream" || s.intent === "stretch" ? "dream" : "bridge";
        return {
          query,
          language,
          lane,
          rationale: String(s.rationale ?? "").trim() || undefined,
        };
      })
      .filter(Boolean),
  };
}

function sanitizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĳ\s/+&.-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoardReady(q: string): boolean {
  const words = q.split(/\s+/).filter(Boolean);
  return q.length >= 3 && words.length >= 2 && words.length <= 5;
}

/**
 * AI turns Career Intent / Strategy / prefs / CV into LinkedIn-ready queries.
 * Universal for warehouse→planner, NGO→impact lead, tech, etc.
 */
export async function synthesizeBoardQueriesFromIntent(
  context: CandidateContext,
  options: {
    emptyFunnel?: boolean;
    language: ResolvedJobSearchLanguage;
    experienceLevel: ExperienceLevel;
  }
): Promise<{
  queryPlans: SearchQueryPlan[];
  rationale: string;
} | null> {
  const profile = context.profile;
  const emptyFunnel = options.emptyFunnel === true;
  const dreamSeeds = getDreamQueries(profile);
  const bridgeSeeds = synthesizeBridgeFromIntent(profile, options.language);
  const never = resolveNeverList(profile);
  const enabledTargets = getEnabledTargetSearchQueries(profile);
  const ladderSeeds = getLadderSearchQueriesFromContext(context, 6);
  const inferred = getTopInferredRolesFromContext(context, 5);
  const intentBlock = formatCareerIntentForPrompt(profile);
  const ladderBlock = formatCareerLadderForPrompt(context);
  const candidateBlock = formatContextForPrompt(context, 10000);

  const slotRules = emptyFunnel
    ? `EMPTY FUNNEL: emit exactly 4 queries — at most 1 dream/stretch phrase, and 3 hireable-now BRIDGE queries employers would actually post.`
    : `NORMAL: emit exactly 4 queries — at most 2 dream/stretch, at least 2 hireable-now BRIDGE. If stretchTolerance is hireable_only, use at most 1 soft dream phrase and 3 bridge.`;

  try {
    const result = await generateStructured(
      `You write LinkedIn/Indeed KEYWORD search queries that explore the PATH toward this candidate's north star.

${ETHOS_AGENT_BLOCK}

You are given Career Intent (north star), Search Strategy (dream/bridge/never), prefs, ladder, and CV.
Search explores the path — board-ready footholds — not dream prose.
Do NOT paste north-star sentences or founder aspirations as queries.
Translate ambitions into titles/phrases that appear on real job boards.

${slotRules}

HARD RULES:
1) Each query: 2–5 words, role-style (e.g. "project officer NGO", "programma coordinator", "social impact manager").
2) NEVER output long sentences, "founder of …", "my own non-profit", or org-building aspirations as queries — map those to hireable NGO/impact/program titles instead.
3) Respect NEVER / anti-goals: do not search those role families (cliffs).
4) If non-negotiables or prefs say avoid "senior" / director / head / VP — do NOT use those words in queries; prefer mid titles even if dream is Head of X.
5) Prefer SAME craft as CV evidence for bridge queries; dream lane may be one mild stretch title only when stretch is allowed.
6) Language: tag nl vs en appropriately for the market; primary language hint = ${options.language}.
7) Experience level hint: ${options.experienceLevel} — do not invent C-level.
8) Sector from prefs (NGO/charity/impact, logistics, etc.) may appear as 1 short keyword when it helps boards (e.g. "NGO", "charity", "logistiek").

SEEDS (refine into board-ready phrases; drop unusable seeds):
Dream seeds: ${dreamSeeds.join(" | ") || "none"}
Bridge seeds: ${bridgeSeeds.join(" | ") || "none"}
Enabled targets: ${enabledTargets.join(" | ") || "none"}
Ladder seeds: ${ladderSeeds.join(" | ") || "none"}
Inferred roles: ${inferred.join(" | ") || "none"}
Never: ${never.join(" | ") || "none"}
Job prefs: ${profile.jobPreferences?.trim() || "none"}

${intentBlock || ""}
${ladderBlock || ""}

Return JSON:
{
  "searchQueries": [
    { "query": "project officer NGO", "language": "en", "lane": "bridge", "rationale": "hireable foothold toward star" },
    { "query": "program coordinator", "language": "en", "lane": "bridge" },
    { "query": "social impact manager", "language": "en", "lane": "dream" },
    { "query": "programma coordinator", "language": "nl", "lane": "bridge" }
  ],
  "rationale": "short explanation of path mix"
}

CANDIDATE:
${candidateBlock}`,
      intentQuerySchema,
      {
        userId: context.userId,
        operation: "intent_board_queries",
        coerce: coerceIntentQueries,
      }
    );

    const neverLower = never.map((n) => n.toLowerCase());
    const plans: SearchQueryPlan[] = [];
    const seen = new Set<string>();

    for (const item of result.searchQueries) {
      const q = sanitizeQuery(item.query);
      if (!isBoardReady(q) || seen.has(q)) continue;
      if (neverLower.some((n) => n.length >= 4 && q.includes(n))) continue;
      seen.add(q);
      plans.push({
        query: q,
        language: item.language === "nl" ? "nl" : "en",
      });
      if (plans.length >= 4) break;
    }

    if (plans.length < 2) return null;

    return {
      queryPlans: plans,
      rationale:
        result.rationale.trim() ||
        "AI board queries synthesized from career intent",
    };
  } catch (e) {
    console.warn("[Intent queries] AI synthesis failed:", e);
    return null;
  }
}

/** Deterministic fallback with sanitization when AI fails. */
export function fallbackBoardQueriesFromIntent(
  context: CandidateContext,
  options: { emptyFunnel?: boolean; language: ResolvedJobSearchLanguage }
): SearchQueryPlan[] {
  const raw = getLaneQueries(context.profile, {
    emptyFunnel: options.emptyFunnel,
    language: options.language,
  });
  const plans: SearchQueryPlan[] = [];
  const seen = new Set<string>();
  for (const q0 of raw) {
    let q = sanitizeQuery(q0);
    const words = q.split(/\s+/);
    if (words.length > 5) q = words.slice(0, 5).join(" ");
    // Drop founder / sentence-like seeds
    if (/\b(founder|my own|non-profit for|humanitarian action)\b/i.test(q)) {
      continue;
    }
    if (!isBoardReady(q) || seen.has(q)) continue;
    seen.add(q);
    plans.push({
      query: q,
      language:
        guessQueryLanguage(q) === "nl" ? "nl" : options.language,
    });
  }

  // Pad with ladder / inferred if too thin
  if (plans.length < 2) {
    for (const seed of [
      ...getLadderSearchQueriesFromContext(context, 4),
      ...getTopInferredRolesFromContext(context, 3),
    ]) {
      let q = sanitizeQuery(seed);
      const words = q.split(/\s+/);
      if (words.length > 5) q = words.slice(0, 5).join(" ");
      if (!isBoardReady(q) || seen.has(q)) continue;
      seen.add(q);
      plans.push({
        query: q,
        language: guessQueryLanguage(q) === "nl" ? "nl" : options.language,
      });
      if (plans.length >= 4) break;
    }
  }

  return plans.slice(0, 4);
}
