export type AiUsageCategory = "profile" | "job_search" | "application" | "other";

export interface AiUsageCategoryTotals {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
}

export interface AiUsageRecord {
  userId: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
  lastUpdatedAt: string;
  recentCalls: AiUsageCall[];
  byCategory?: Partial<Record<AiUsageCategory, AiUsageCategoryTotals>>;
}

export interface AiUsageAccountSummary extends AiUsageRecord {
  email: string | null;
  name: string | null;
}

export interface AiUsageAdminOverview {
  accounts: AiUsageAccountSummary[];
  totals: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    requestCount: number;
    estimatedCostUsd: number;
    accountCount: number;
  };
}

export interface AiUsageCall {
  operation: string;
  category?: AiUsageCategory;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  at: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}
