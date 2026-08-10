"use client";

import { Card, CardTitle } from "@/components/ui/card";
import type { AiUsageRecord } from "@/lib/types/ai-usage";
import {
  AI_USAGE_CATEGORY_LABELS,
  getCategoryTotals,
  type AiUsageCategory,
} from "@/lib/ai-usage/categories";
import { Sparkles } from "lucide-react";

interface AiUsageCardProps {
  aiUsage: AiUsageRecord | null;
  loading?: boolean;
}

export function AiUsageCard({ aiUsage, loading }: AiUsageCardProps) {
  return (
    <Card>
      <CardTitle className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-500" />
        Gemini AI usage
      </CardTitle>
      <p className="mt-1 text-sm text-zinc-500">
        Tokens and estimated cost for this account.
      </p>
      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading usage…</p>
      ) : aiUsage ? (
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Total tokens</dt>
            <dd className="font-medium">
              {aiUsage.totalTokens.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Input tokens</dt>
            <dd>{aiUsage.promptTokens.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Output tokens</dt>
            <dd>{aiUsage.completionTokens.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">API requests</dt>
            <dd>{aiUsage.requestCount}</dd>
          </div>
          <div className="flex justify-between border-t border-zinc-100 pt-2">
            <dt className="text-zinc-500">Est. cost</dt>
            <dd className="font-medium">
              ${aiUsage.estimatedCostUsd.toFixed(4)}
            </dd>
          </div>
          {(() => {
            const byCategory = getCategoryTotals(aiUsage);
            const categories = (
              ["profile", "job_search", "application"] as AiUsageCategory[]
            ).filter((c) => byCategory[c].requestCount > 0);
            if (categories.length === 0) return null;
            return (
              <div className="border-t border-zinc-100 pt-2">
                <dt className="mb-2 text-zinc-500">By feature</dt>
                <ul className="space-y-2 text-sm">
                  {categories.map((category) => {
                    const stats = byCategory[category];
                    return (
                      <li
                        key={category}
                        className="flex justify-between gap-2"
                      >
                        <span className="text-zinc-600">
                          {AI_USAGE_CATEGORY_LABELS[category]}
                        </span>
                        <span className="shrink-0 text-zinc-500">
                          {stats.totalTokens.toLocaleString()} tok · $
                          {stats.estimatedCostUsd.toFixed(4)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
          {aiUsage.recentCalls.length > 0 && (
            <div className="pt-2">
              <dt className="mb-1 text-zinc-500">Recent calls</dt>
              <ul className="space-y-1 text-xs text-zinc-600">
                {aiUsage.recentCalls.slice(0, 5).map((call, i) => (
                  <li
                    key={`${call.at}-${i}`}
                    className="flex justify-between gap-2"
                  >
                    <span className="truncate">
                      {call.operation.replace(/_/g, " ")}
                      {call.category === "job_search" && (
                        <span className="text-violet-500"> · search</span>
                      )}
                    </span>
                    <span className="shrink-0 text-zinc-400">
                      {call.totalTokens} tok
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No AI usage yet. Run Re-analyze or Find Jobs to start.
        </p>
      )}
    </Card>
  );
}
