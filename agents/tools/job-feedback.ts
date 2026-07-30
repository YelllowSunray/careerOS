import { z } from "zod";
import { generateStructured } from "@/lib/gemini/client";
import { normalizeFeedbackReview, normalizeFeedbackResynth } from "@/lib/gemini/coerce";
import {
  formatCareerLadderForPrompt,
  formatContextForPrompt,
} from "@/lib/candidate/context";
import { nowIso } from "@/lib/utils/dates";
import {
  getFeedbackPreferenceState,
  getJobFeedbacks,
  getJobMatches,
  getJobs,
  saveFeedbackPreferenceState,
  saveJobFeedback,
  saveJobMatch,
} from "@/services/firestore";
import type { CandidateContext } from "@/lib/types/candidate-context";
import type {
  FeedbackPreferenceState,
  FeedbackReviewResult,
  Job,
  JobFeedback,
  JobMatch,
} from "@/lib/types";

const experienceLevelSchema = z.preprocess(
  (val) => {
    if (val == null || val === "" || val === "null" || val === "none" || val === "undefined") {
      return undefined;
    }
    return val;
  },
  z.enum(["junior", "mid", "senior", "staff", "principal"]).optional()
);

const reviewSchema = z.object({
  theme: z.enum([
    "too_senior",
    "too_junior",
    "wrong_craft",
    "location_commute",
    "compensation",
    "company_stage",
    "schedule_type",
    "other",
  ]),
  aiStance: z.enum(["agree", "soft_pushback", "strong_pushback"]),
  aiExplanation: z.string(),
  constraintSummary: z.string(),
  proposedExperienceCeiling: experienceLevelSchema,
  userLikelyCorrect: z.boolean(),
});

const resynthSchema = z.object({
  guidanceSummary: z.string(),
  learnedConstraints: z.array(z.string()).min(1).max(8),
  experienceCeiling: experienceLevelSchema,
});

const applyFilterSchema = z.object({
  results: z.array(
    z.object({
      jobId: z.string(),
      feedbackRequirementMet: z.boolean(),
      feedbackNotes: z.string(),
      violatedConstraintIndexes: z.array(z.number()).optional(),
    })
  ),
});

/** AI reviews a dislike before we learn from it — may push back. */
export async function reviewJobFeedback(input: {
  context: CandidateContext;
  job: Job;
  match?: JobMatch | null;
  reason: string;
  reasonHint?: string;
}): Promise<FeedbackReviewResult> {
  const candidateBlock = formatContextForPrompt(input.context, 10000);
  const ladderBlock = formatCareerLadderForPrompt(input.context);
  const matchBlock = input.match
    ? `Fit ${input.match.fitScore} · path=${input.match.pathType ?? "?"} · craft=${input.match.coreCraftFit ?? "?"} · scope=${input.match.scopeIncrease ?? "?"}
Reasoning: ${input.match.reasoning}
Skill notes: ${input.match.skillNotes ?? ""}`
    : "(no match scores)";

  const result = await generateStructured(
    `You are a candid career coach. The candidate disliked a job listing. Review whether their reason is fair — do NOT rubber-stamp.

USER FEEDBACK:
Reason: """${input.reason.trim()}"""
${input.reasonHint ? `Hint chip: ${input.reasonHint}` : ""}

JOB:
Title: ${input.job.title}
Company: ${input.job.company}
Location: ${input.job.location}
Description (excerpt):
${input.job.description.slice(0, 6000)}

MATCH CONTEXT:
${matchBlock}

${ladderBlock || ""}

CANDIDATE:
${candidateBlock}

Decide:
1) theme — MUST be exactly one of:
   too_senior | too_junior | wrong_craft | location_commute | compensation | company_stage | schedule_type | other
   Map role-type / consulting-vs-in-house / unfamiliar-function dislikes to wrong_craft (not a custom label).
2) aiStance:
   - agree: their reason is clearly fair for THIS job vs THEIR profile
   - soft_pushback: debatable — explain why it might still be a good step
   - strong_pushback: their reason looks wrong (e.g. they say "too senior" but the role is a realistic mid step-up)
3) aiExplanation — 2–4 sentences, direct, evidence-based. If pushback, say why they might still want it.
4) constraintSummary — ONE durable preference sentence to apply to FUTURE jobs IF they confirm learning
   (e.g. "Prefer mid-level compliance/ops leadership; avoid roles requiring 8+ years senior management or staff-level ownership.")
5) proposedExperienceCeiling — only when theme is too_senior (or similar) and learning would lower the search ceiling
6) userLikelyCorrect — true if agree or soft_pushback leaning their way

Be opinionated. Prefer honest pushback over false agreement when the ladder says this is a good stretch.

Return JSON only with theme from the allowed list above.`,
    reviewSchema,
    {
      userId: input.context.userId,
      operation: "job_feedback_review",
      coerce: normalizeFeedbackReview,
    }
  );

  return {
    theme: result.theme,
    aiStance: result.aiStance,
    aiExplanation: result.aiExplanation.trim(),
    constraintSummary: result.constraintSummary.trim(),
    proposedExperienceCeiling: result.proposedExperienceCeiling,
    userLikelyCorrect: result.userLikelyCorrect,
  };
}

/** Rebuild durable guidance from all confirmed learn=true feedbacks. */
export async function resynthesizeFeedbackPreferences(
  context: CandidateContext,
  feedbacks: JobFeedback[]
): Promise<FeedbackPreferenceState> {
  const learning = feedbacks.filter((f) => f.learn);
  const hiddenJobIds = [
    ...new Set(
      feedbacks.filter((f) => f.hideJob).map((f) => f.jobId).filter(Boolean)
    ),
  ];

  if (learning.length === 0) {
    const state: FeedbackPreferenceState = {
      userId: context.userId,
      learnedConstraints: [],
      guidanceSummary: "No active preference lessons from listing feedback.",
      hiddenJobIds,
      updatedAt: nowIso(),
    };
    await saveFeedbackPreferenceState(state);
    return state;
  }

  const feedbackBlock = learning
    .map(
      (f, i) =>
        `[${i}] ${f.jobTitle} @ ${f.company} · theme=${f.theme} · stance=${f.aiStance}
User: ${f.reason}
Constraint: ${f.constraintSummary}`
    )
    .join("\n\n");

  const result = await generateStructured(
    `Synthesize durable JOB SEARCH / MATCH CONSTRAINTS from the candidate's confirmed listing feedback.

These constraints will filter future discoveries and re-filter jobs already on screen.
Use AI judgment — do not invent keyword blacklists. Prefer concise, actionable preference rules.

FEEDBACKS (confirmed learn):
${feedbackBlock}

CANDIDATE CONTEXT (short):
Level hint: ${context.structuredProfile?.experienceLevel ?? "unknown"}
Ladder: ${context.structuredProfile?.careerLadder?.summary ?? "n/a"}

Return:
- guidanceSummary: 1–2 sentences on how to steer search/match now
- learnedConstraints: 2–6 short bullets (what to prefer / avoid)
- experienceCeiling: optional string junior|mid|senior|staff|principal — ONLY if feedback clearly asks to avoid more senior bands. Otherwise OMIT the field entirely (do not send null).

JSON only.`,
    resynthSchema,
    {
      userId: context.userId,
      operation: "job_feedback_resynth",
      coerce: normalizeFeedbackResynth,
    }
  );

  const state: FeedbackPreferenceState = {
    userId: context.userId,
    learnedConstraints: result.learnedConstraints.map((c) => c.trim()).filter(Boolean),
    guidanceSummary: result.guidanceSummary.trim(),
    experienceCeiling: result.experienceCeiling,
    hiddenJobIds,
    updatedAt: nowIso(),
  };
  await saveFeedbackPreferenceState(state);
  return state;
}

/** AI re-filters saved jobs against learned constraints. */
export async function applyFeedbackConstraintsToSavedJobs(
  context: CandidateContext,
  state: FeedbackPreferenceState
): Promise<number> {
  const [jobs, matches] = await Promise.all([
    getJobs(context.userId),
    getJobMatches(context.userId),
  ]);
  if (jobs.length === 0) return 0;

  const matchByJob = new Map(matches.map((m) => [m.jobId, m]));
  const constraints = state.learnedConstraints;
  const hidden = new Set(state.hiddenJobIds);

  // Always hide explicitly disliked jobs.
  let updated = 0;
  for (const jobId of hidden) {
    const match = matchByJob.get(jobId);
    if (!match) continue;
    if (match.feedbackRequirementMet === false) continue;
    await saveJobMatch({
      ...match,
      feedbackRequirementMet: false,
      feedbackNotes: "Hidden from your feedback on this listing.",
      violatedFeedbackIds: match.violatedFeedbackIds,
    });
    updated++;
  }

  if (constraints.length === 0) {
    // Clear constraint-based hides for jobs not in hidden set.
    for (const match of matches) {
      if (hidden.has(match.jobId)) continue;
      if (match.feedbackRequirementMet === false) {
        await saveJobMatch({
          ...match,
          feedbackRequirementMet: true,
          feedbackNotes: "",
          violatedFeedbackIds: [],
        });
        updated++;
      }
    }
    return updated;
  }

  const listingBlock = jobs
    .filter((j) => !hidden.has(j.id))
    .slice(0, 40)
    .map((j) => {
      const m = matchByJob.get(j.id);
      return `[${j.id}] ${j.title} @ ${j.company} | ${j.location} | fit=${m?.fitScore ?? "?"} path=${m?.pathType ?? "?"} craft=${m?.coreCraftFit ?? "?"}
${(j.description || "").slice(0, 400)}`;
    })
    .join("\n\n");

  if (!listingBlock.trim()) return updated;

  const constraintBlock = constraints
    .map((c, i) => `${i}. ${c}`)
    .join("\n");

  const result = await generateStructured(
    `Filter which saved jobs should stay visible given the candidate's LEARNED preference constraints from feedback.

CONSTRAINTS:
${constraintBlock}
Guidance: ${state.guidanceSummary}
${state.experienceCeiling ? `Soft experience ceiling: ${state.experienceCeiling}` : ""}

Rules (AI judgment):
- feedbackRequirementMet=false ONLY when the job clearly violates a constraint
- When uncertain, keep the job (feedbackRequirementMet=true)
- Do not invent hard keyword bans — judge role scope, craft, location, seniority honestly
- Return one result per job id listed

JOBS:
${listingBlock}

Return JSON: { "results": [{ "jobId", "feedbackRequirementMet", "feedbackNotes", "violatedConstraintIndexes" }] }`,
    applyFilterSchema,
    {
      userId: context.userId,
      operation: "job_feedback_apply",
    }
  );

  const byId = new Map(result.results.map((r) => [r.jobId, r]));
  for (const job of jobs) {
    if (hidden.has(job.id)) continue;
    const match = matchByJob.get(job.id);
    if (!match) continue;
    const r = byId.get(job.id);
    if (!r) continue;
    await saveJobMatch({
      ...match,
      feedbackRequirementMet: r.feedbackRequirementMet,
      feedbackNotes: r.feedbackNotes?.trim() || "",
      violatedFeedbackIds: [],
    });
    updated++;
  }

  return updated;
}

export async function confirmJobFeedback(input: {
  context: CandidateContext;
  job: Job;
  match?: JobMatch | null;
  reason: string;
  reasonHint?: string;
  review: FeedbackReviewResult;
  /** hide & learn vs hide this listing only */
  mode: "learn" | "hide_only";
}): Promise<{ feedback: JobFeedback; state: FeedbackPreferenceState; refiltered: number }> {
  const feedback: JobFeedback = {
    id: `fb_${input.context.userId}_${Date.now()}`,
    userId: input.context.userId,
    jobId: input.job.id,
    jobTitle: input.job.title,
    company: input.job.company,
    reason: input.reason.trim(),
    reasonHint: input.reasonHint,
    theme: input.review.theme,
    constraintSummary: input.review.constraintSummary,
    aiStance: input.review.aiStance,
    aiExplanation: input.review.aiExplanation,
    learn: input.mode === "learn",
    hideJob: true,
    createdAt: nowIso(),
  };
  await saveJobFeedback(feedback);

  const all = await getJobFeedbacks(input.context.userId);
  const state =
    input.mode === "learn"
      ? await resynthesizeFeedbackPreferences(input.context, all)
      : await (async () => {
          const prev =
            (await getFeedbackPreferenceState(input.context.userId)) ?? {
              userId: input.context.userId,
              learnedConstraints: [],
              guidanceSummary: "No active preference lessons from listing feedback.",
              hiddenJobIds: [],
              updatedAt: nowIso(),
            };
          const next: FeedbackPreferenceState = {
            ...prev,
            hiddenJobIds: [...new Set([...prev.hiddenJobIds, input.job.id])],
            updatedAt: nowIso(),
          };
          await saveFeedbackPreferenceState(next);
          return next;
        })();

  const refiltered = await applyFeedbackConstraintsToSavedJobs(
    input.context,
    state
  );

  return { feedback, state, refiltered   };
}


/** True when a feedback lesson likely produced (or matches) this constraint bullet. */
export function feedbackMatchesConstraint(
  feedback: JobFeedback,
  constraint: string
): boolean {
  const target = constraint.trim().toLowerCase();
  if (!target) return false;
  const summary = (feedback.constraintSummary || "").trim().toLowerCase();
  const reason = (feedback.reason || "").trim().toLowerCase();
  if (!summary && !reason) return false;
  if (summary === target) return true;
  if (summary && (summary.includes(target) || target.includes(summary))) {
    return true;
  }
  const tokens = target.split(/[^a-z0-9]+/).filter((t) => t.length > 4);
  if (tokens.length === 0) return false;
  const hits = tokens.filter(
    (t) => summary.includes(t) || reason.includes(t)
  ).length;
  return hits >= Math.min(2, tokens.length);
}

/**
 * Remove one taught filter: disable related learn=true feedbacks, resynthesize,
 * and re-filter saved jobs so matching listings can reappear.
 */
export async function removeLearnedConstraint(
  context: CandidateContext,
  constraint: string
): Promise<{ state: FeedbackPreferenceState; refiltered: number }> {
  const all = await getJobFeedbacks(context.userId);
  for (const fb of all) {
    if (!fb.learn) continue;
    if (!feedbackMatchesConstraint(fb, constraint)) continue;
    await saveJobFeedback({ ...fb, learn: false });
  }

  const remaining = await getJobFeedbacks(context.userId);
  let state = await resynthesizeFeedbackPreferences(context, remaining);

  const nextConstraints = state.learnedConstraints.filter(
    (c) => c.trim().toLowerCase() !== constraint.trim().toLowerCase()
  );
  if (nextConstraints.length !== state.learnedConstraints.length) {
    state = {
      ...state,
      learnedConstraints: nextConstraints,
      guidanceSummary:
        nextConstraints.length === 0
          ? "No active preference lessons from listing feedback."
          : state.guidanceSummary,
      updatedAt: nowIso(),
    };
    await saveFeedbackPreferenceState(state);
  }

  const refiltered = await applyFeedbackConstraintsToSavedJobs(context, state);
  return { state, refiltered };
}

export function formatFeedbackPreferencesForPrompt(
  state: FeedbackPreferenceState | null | undefined
): string {
  if (!state) return "";
  const parts: string[] = [];
  if (state.learnedConstraints.length > 0) {
    parts.push(`USER-TAUGHT SEARCH CONSTRAINTS (from listing feedback — HARD soft-veto for match):
${state.learnedConstraints.map((c) => `- ${c}`).join("\n")}
Guidance: ${state.guidanceSummary}
${state.experienceCeiling ? `Prefer roles at or below ~${state.experienceCeiling} seniority unless contribution is clearly credible.` : ""}
If a job clearly violates these constraints, set skillRequirementMet thoughtfully via craft/seniority judgment OR treat as poor fit (low contribution / lateral) — prefer not recommending them.`);
  }
  return parts.join("\n");
}
