import type {
  CareerIntent,
  SearchStrategy,
  UserProfile,
} from "@/lib/types";
import { getEnabledTargetSearchQueries } from "@/lib/job-search/target-roles";
import { showStretchTargetsEnabled } from "@/lib/job-search/career-intent";
import type { SearchQueryPlan } from "@/lib/job-search/locale";
import { guessQueryLanguage } from "@/lib/job-search/locale";

const DEFAULT_NEVER_FLOOR = [
  "heftruckchauffeur",
  "heftruck",
  "orderpicker",
  "order picker",
  "magazijnmedewerker",
  "warehouse worker",
  "productiemedewerker",
  "production worker",
  "picker",
  "packer",
];

const DEFAULT_OFFICE_BRIDGE_NL = [
  "logistiek administratief",
  "orderadministrator",
  "junior planning support",
  "coördinator logistiek",
  "magazijn administratie",
  "planning medewerker kantoor",
];

const DEFAULT_OFFICE_BRIDGE_EN = [
  "logistics administrator",
  "order administrator",
  "junior supply planner",
  "logistics coordinator",
  "warehouse administration",
  "planning support office",
];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hasConfirmedStrategy(
  strategy?: SearchStrategy | null
): boolean {
  if (!strategy) return false;
  return (
    strategy.dream.length + strategy.bridge.length + strategy.never.length > 0
  );
}

/** Merge strategy never + intent anti-goals + default floor titles when office-bound. */
export function resolveNeverList(
  profile: Pick<UserProfile, "careerIntent" | "searchStrategy" | "jobPreferences">
): string[] {
  const fromStrategy = profile.searchStrategy?.never ?? [];
  const fromAnti = profile.careerIntent?.antiGoals ?? [];
  const prefs = (profile.jobPreferences ?? "").toLowerCase();
  const officeBound =
    profile.careerIntent?.workSetting === "office" ||
    /niet.*magazijn|not.*warehouse|kantoor|office|no hands-?on/i.test(prefs);

  const merged = [
    ...fromStrategy,
    ...fromAnti,
    ...(officeBound ? DEFAULT_NEVER_FLOOR : []),
  ];
  return [...new Set(merged.map(norm).filter((x) => x.length >= 3))];
}

export function violatesNeverList(
  title: string,
  neverList: string[]
): boolean {
  const t = norm(title);
  if (!t || neverList.length === 0) return false;
  return neverList.some((n) => t.includes(n) || n.includes(t));
}

export function synthesizeBridgeFromIntent(
  profile: Pick<
    UserProfile,
    "careerIntent" | "searchStrategy" | "jobPreferences" | "targetRoles"
  >,
  language: "nl" | "en" = "nl"
): string[] {
  const fromStrategy = (profile.searchStrategy?.bridge ?? [])
    .map(norm)
    .filter(Boolean);
  if (fromStrategy.length >= 3) return fromStrategy.slice(0, 6);

  const defaults =
    language === "nl" ? DEFAULT_OFFICE_BRIDGE_NL : DEFAULT_OFFICE_BRIDGE_EN;
  const horizon = profile.careerIntent?.horizon.now ?? [];
  const prefs = profile.jobPreferences?.toLowerCase() ?? "";
  const office =
    profile.careerIntent?.workSetting === "office" ||
    /kantoor|office|planner|administrat/i.test(prefs);

  const extras: string[] = [];
  if (office) {
    extras.push(...defaults);
  }
  for (const h of horizon) {
    const q = norm(h);
    if (q && !DEFAULT_NEVER_FLOOR.some((n) => q.includes(n))) extras.push(q);
  }

  return [...new Set([...fromStrategy, ...extras])].slice(0, 6);
}

export function getDreamQueries(
  profile: Pick<UserProfile, "searchStrategy" | "targetRoles" | "careerIntent">
): string[] {
  const fromStrategy = (profile.searchStrategy?.dream ?? [])
    .map(norm)
    .filter(Boolean);
  if (fromStrategy.length > 0) return fromStrategy.slice(0, 3);

  const fromTargets = getEnabledTargetSearchQueries(profile);
  if (fromTargets.length > 0) return fromTargets.slice(0, 3);

  const north = profile.careerIntent?.northStar?.trim();
  return north ? [norm(north)] : [];
}

/**
 * Build up to 4 lane queries.
 * emptyFunnel: 1 dream + 3 bridge; else up to 2 dream + rest bridge.
 */
export function getLaneQueries(
  profile: Pick<
    UserProfile,
    "careerIntent" | "searchStrategy" | "jobPreferences" | "targetRoles"
  >,
  options?: { emptyFunnel?: boolean; language?: "nl" | "en" }
): string[] {
  const emptyFunnel = options?.emptyFunnel === true;
  const language = options?.language ?? "nl";
  const dream = getDreamQueries(profile);
  const bridge = synthesizeBridgeFromIntent(profile, language);
  const never = new Set(resolveNeverList(profile));

  const filterNever = (q: string) =>
    !never.has(q) && ![...never].some((n) => q.includes(n));

  const dreamClean = dream.filter(filterNever);
  const bridgeClean = bridge.filter(
    (q) => filterNever(q) && !dreamClean.includes(q)
  );

  const dreamSlots = emptyFunnel ? 1 : 2;
  const pickedDream = dreamClean.slice(0, dreamSlots);
  const need = 4 - pickedDream.length;
  const pickedBridge = bridgeClean.slice(0, Math.max(need, 0));

  return [...pickedDream, ...pickedBridge].slice(0, 4);
}

export function laneQueriesToPlans(
  queries: string[],
  defaultLang: "nl" | "en"
): SearchQueryPlan[] {
  return queries.map((query) => ({
    query,
    language:
      guessQueryLanguage(query) === "nl" ? ("nl" as const) : defaultLang,
  }));
}

/** Title overlaps an enabled dream/target role (for stretch save). */
export function titleMatchesDreamTarget(
  jobTitle: string,
  profile: Pick<UserProfile, "targetRoles" | "searchStrategy">
): boolean {
  const title = norm(jobTitle);
  if (!title) return false;

  const phrases: string[] = [
    ...(profile.searchStrategy?.dream ?? []),
    ...(profile.targetRoles?.enabled ?? []),
    profile.targetRoles?.primary ?? "",
  ]
    .map(norm)
    .filter((p) => p.length >= 3);

  return phrases.some((p) => {
    const tokens = p.split(" ").filter((t) => t.length >= 4);
    if (tokens.length === 0) return title.includes(p) || p.includes(title);
    return tokens.every((t) => title.includes(t)) || title.includes(p);
  });
}

export function shouldUseStrategyLanes(
  profile: Pick<UserProfile, "searchStrategy" | "targetRoles" | "careerIntent">
): boolean {
  return (
    hasConfirmedStrategy(profile.searchStrategy) ||
    getEnabledTargetSearchQueries(profile).length > 0 ||
    Boolean(profile.careerIntent?.northStar?.trim())
  );
}

/**
 * When stretch is enabled and the title matches a dream/target, convert
 * not_eligible → showable stretch (with_ramp, capped fit, pathType stretch).
 * Never applies if the title hits the never list.
 */
export function applyDreamStretchIfNeeded<T extends {
  coreCraftFit?: string;
  skillRequirementMet?: boolean;
  fitScore: number;
  pathType?: string;
  missingSkills?: Array<{
    skill: string;
    learnability?: string;
    isHardRequirement?: boolean;
  }>;
  skillNotes?: string;
  reasoning?: string;
}>(
  match: T,
  jobTitle: string,
  profile: Pick<
    UserProfile,
    | "settings"
    | "careerIntent"
    | "searchStrategy"
    | "targetRoles"
    | "jobPreferences"
  >
): T {
  if (!showStretchTargetsEnabled(profile)) return match;
  if (match.pathType === "regressive") return match;
  if (match.coreCraftFit !== "not_eligible" && match.skillRequirementMet !== false) {
    return match;
  }
  if (violatesNeverList(jobTitle, resolveNeverList(profile))) {
    return match;
  }
  if (!titleMatchesDreamTarget(jobTitle, profile)) {
    return match;
  }

  const missingSkills = (match.missingSkills ?? []).map((s) => ({
    ...s,
    learnability:
      s.learnability === "must_have" ? "learn_on_job" : s.learnability,
    isHardRequirement: false,
  }));

  return {
    ...match,
    coreCraftFit: "with_ramp",
    skillRequirementMet: true,
    pathType: "stretch",
    fitScore: Math.min(Math.max(match.fitScore, 48), 55),
    missingSkills,
    skillNotes:
      (match.skillNotes?.trim() ||
        "Dream-target stretch: craft gaps remain; shown because you enabled this target.") +
      " (stretch save)",
    reasoning:
      (match.reasoning?.trim() || "") +
      " Shown as stretch toward your enabled dream/target role despite craft gaps.",
  };
}

export function defaultStrategyFromIntent(
  intent: CareerIntent,
  language: "nl" | "en" = "nl"
): SearchStrategy {
  const dream = [
    intent.northStar,
    ...intent.horizon.now,
  ]
    .map(norm)
    .filter(Boolean)
    .slice(0, 3);

  const bridge = synthesizeBridgeFromIntent(
    { careerIntent: intent, searchStrategy: undefined, jobPreferences: intent.narrative },
    language
  );

  const never = [
    ...intent.antiGoals,
    ...(intent.workSetting === "office" ? DEFAULT_NEVER_FLOOR : []),
  ]
    .map(norm)
    .filter(Boolean);

  return {
    dream: [...new Set(dream)].slice(0, 4),
    bridge: bridge.slice(0, 6),
    never: [...new Set(never)].slice(0, 12),
    confirmedAt: new Date().toISOString(),
  };
}
