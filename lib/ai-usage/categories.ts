import type { AiUsageCategoryTotals, AiUsageRecord } from "@/lib/types/ai-usage";

export type AiUsageCategory = "profile" | "job_search" | "application" | "other";

export const AI_USAGE_CATEGORY_LABELS: Record<AiUsageCategory, string> = {
  profile: "Profile extraction",
  job_search: "Job search",
  application: "Applications",
  other: "Other",
};

const JOB_SEARCH_OPS = new Set([
  "job_search_queries",
  "intent_board_queries",
  "listing_relevance",
  "listing_validate",
  "job_listing_extract",
  "listing_match",
  "job_parse",
  "job_match",
  "education_recommend",
  "job_feedback_review",
  "job_feedback_resynth",
  "job_feedback_apply",
  "listing_open_check",
  "jobs_coach",
]);

const APPLICATION_OPS = new Set([
  "application_generate",
  "cover_letter_generate",
  "cover_letter_job_parse",
  "application_answer",
  "field_resolve",
  "browser_action",
]);

const PROFILE_OPS = new Set([
  "resume_extraction",
  "resume_text_extraction",
  "candidate_synthesis",
  "portfolio_extraction",
  "document_extraction",
  "linkedin_profile_extract",
  "suggest_target_roles",
  "career_intake",
]);

export function categorizeAiOperation(operation: string): AiUsageCategory {
  if (JOB_SEARCH_OPS.has(operation)) return "job_search";
  if (APPLICATION_OPS.has(operation)) return "application";
  if (PROFILE_OPS.has(operation)) return "profile";
  return "other";
}

const EMPTY_TOTALS: AiUsageCategoryTotals = {
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  requestCount: 0,
  estimatedCostUsd: 0,
};

export function emptyCategoryTotals(): Record<AiUsageCategory, AiUsageCategoryTotals> {
  return {
    profile: { ...EMPTY_TOTALS },
    job_search: { ...EMPTY_TOTALS },
    application: { ...EMPTY_TOTALS },
    other: { ...EMPTY_TOTALS },
  };
}

export function getCategoryTotals(
  record: AiUsageRecord
): Record<AiUsageCategory, AiUsageCategoryTotals> {
  const totals = emptyCategoryTotals();

  if (record.byCategory) {
    for (const category of Object.keys(totals) as AiUsageCategory[]) {
      if (record.byCategory[category]) {
        totals[category] = { ...record.byCategory[category]! };
      }
    }
    return totals;
  }

  for (const call of record.recentCalls) {
    const category = categorizeAiOperation(call.operation);
    const bucket = totals[category];
    bucket.totalTokens += call.totalTokens;
    bucket.promptTokens += call.promptTokens;
    bucket.completionTokens += call.completionTokens;
    bucket.requestCount += 1;
    bucket.estimatedCostUsd += call.estimatedCostUsd;
  }

  return totals;
}
