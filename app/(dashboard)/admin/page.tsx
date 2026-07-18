"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useApi } from "@/lib/hooks/use-api";
import { isAdminEmail } from "@/lib/admin/config";
import {
  AI_USAGE_CATEGORY_LABELS,
  getCategoryTotals,
  type AiUsageCategory,
} from "@/lib/ai-usage/categories";
import type { AiUsageAdminOverview } from "@/lib/types/ai-usage";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Shield } from "lucide-react";

function formatUsd(n: number) {
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number) {
  return n.toLocaleString();
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [data, setData] = useState<AiUsageAdminOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAdmin = isAdminEmail(user?.email);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const overview = await apiFetch("/api/admin/usage");
      setData(overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdminEmail(user.email)) {
      router.replace("/profile");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when admin session is ready
  }, [authLoading, user, router]);

  if (authLoading || (!isAdmin && user)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
      </div>
    );
  }

  if (!isAdmin) return null;

  const totals = data?.totals;
  const accounts = data?.accounts ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Shield className="h-6 w-6" />
            Admin — Gemini usage
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Per-account token and cost totals across search, cover letters, and
            all other Gemini calls.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {totals && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Est. total cost
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatUsd(totals.estimatedCostUsd)}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Total tokens
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatTokens(totals.totalTokens)}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              API requests
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatTokens(totals.requestCount)}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Accounts
            </p>
            <p className="mt-1 text-2xl font-semibold">{totals.accountCount}</p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Input / output
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-800">
              {formatTokens(totals.promptTokens)} /{" "}
              {formatTokens(totals.completionTokens)}
            </p>
          </Card>
        </div>
      )}

      <Card>
        <CardTitle>Usage by account</CardTitle>
        {loading && !data ? (
          <p className="mt-4 text-sm text-zinc-500">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No usage recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="pb-2 pr-3 font-medium">Account</th>
                  <th className="pb-2 pr-3 font-medium">Tokens</th>
                  <th className="pb-2 pr-3 font-medium">Requests</th>
                  <th className="pb-2 pr-3 font-medium">Est. cost</th>
                  <th className="pb-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const open = expanded === account.userId;
                  const byCategory = getCategoryTotals(account);
                  const categories = (
                    [
                      "profile",
                      "job_search",
                      "application",
                      "other",
                    ] as AiUsageCategory[]
                  ).filter((c) => byCategory[c].requestCount > 0);

                  return (
                    <Fragment key={account.userId}>
                      <tr
                        className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50"
                        onClick={() =>
                          setExpanded(open ? null : account.userId)
                        }
                      >
                        <td className="py-3 pr-3">
                          <div className="font-medium text-zinc-900">
                            {account.email ?? account.name ?? "Unknown"}
                          </div>
                          <div className="font-mono text-xs text-zinc-400">
                            {account.userId}
                          </div>
                        </td>
                        <td className="py-3 pr-3 tabular-nums">
                          {formatTokens(account.totalTokens)}
                        </td>
                        <td className="py-3 pr-3 tabular-nums">
                          {account.requestCount}
                        </td>
                        <td className="py-3 pr-3 font-medium tabular-nums">
                          {formatUsd(account.estimatedCostUsd)}
                        </td>
                        <td className="py-3 text-zinc-500">
                          {account.lastUpdatedAt
                            ? new Date(account.lastUpdatedAt).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-zinc-100 bg-zinc-50/80">
                          <td colSpan={5} className="px-3 py-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                                  By feature
                                </p>
                                {categories.length === 0 ? (
                                  <p className="text-xs text-zinc-500">
                                    No category breakdown yet.
                                  </p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {categories.map((category) => {
                                      const stats = byCategory[category];
                                      return (
                                        <li
                                          key={category}
                                          className="flex justify-between gap-3 text-sm"
                                        >
                                          <span className="text-zinc-600">
                                            {AI_USAGE_CATEGORY_LABELS[category]}
                                          </span>
                                          <span className="shrink-0 tabular-nums text-zinc-500">
                                            {formatTokens(stats.totalTokens)} tok ·{" "}
                                            {formatUsd(stats.estimatedCostUsd)}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                                  Recent calls
                                </p>
                                {(account.recentCalls ?? []).length === 0 ? (
                                  <p className="text-xs text-zinc-500">None</p>
                                ) : (
                                  <ul className="space-y-1 text-xs text-zinc-600">
                                    {account.recentCalls
                                      .slice(0, 8)
                                      .map((call, i) => (
                                        <li
                                          key={`${call.at}-${i}`}
                                          className="flex justify-between gap-2"
                                        >
                                          <span className="truncate">
                                            {call.operation.replace(/_/g, " ")}
                                          </span>
                                          <span className="shrink-0 tabular-nums text-zinc-400">
                                            {call.totalTokens} tok
                                          </span>
                                        </li>
                                      ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
