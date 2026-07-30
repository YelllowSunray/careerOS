"use client";

import { useEffect, useState } from "react";
import type { CandidateProfile, TargetRolesPreference, UserProfile } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { enabledHireabilityWarnings } from "@/lib/job-search/target-roles";

interface TargetRolesSectionProps {
  profile: UserProfile;
  candidate: CandidateProfile | null;
  onSave: (update: Partial<UserProfile>) => Promise<void>;
  apiFetch: <T = unknown>(
    path: string,
    init?: RequestInit
  ) => Promise<T>;
}

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function TargetRolesSection({
  profile,
  candidate,
  onSave,
  apiFetch,
}: TargetRolesSectionProps) {
  const saved = profile.targetRoles;
  const [primary, setPrimary] = useState(saved?.primary ?? "");
  const [enabled, setEnabled] = useState<string[]>(saved?.enabled ?? []);
  const [suggested, setSuggested] = useState(saved?.suggested ?? []);
  const [suggestedAt, setSuggestedAt] = useState(saved?.suggestedAt);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const tr = profile.targetRoles;
    setPrimary(tr?.primary ?? "");
    setEnabled(tr?.enabled ?? []);
    setSuggested(tr?.suggested ?? []);
    setSuggestedAt(tr?.suggestedAt);
  }, [profile.targetRoles]);

  const draft: TargetRolesPreference = {
    primary: primary.trim(),
    suggested,
    enabled,
    ...(suggestedAt ? { suggestedAt } : {}),
  };

  const warnings = enabledHireabilityWarnings(draft);

  async function persist(next: TargetRolesPreference) {
    setSaving(true);
    setError("");
    try {
      await onSave({ targetRoles: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function toggleEnabled(role: string) {
    const key = normKey(role);
    const isOn = enabled.some((e) => normKey(e) === key);
    let nextEnabled: string[];
    if (isOn) {
      nextEnabled = enabled.filter((e) => normKey(e) !== key);
    } else {
      if (enabled.length >= 3) {
        setError("Select up to 3 roles to search (3 of 4 queries).");
        return;
      }
      nextEnabled = [...enabled, role.trim()];
    }
    setError("");
    setEnabled(nextEnabled);
    void persist({
      primary: primary.trim(),
      suggested,
      enabled: nextEnabled,
      ...(suggestedAt ? { suggestedAt } : {}),
    });
  }

  async function handleSuggest() {
    const p = primary.trim();
    if (!p) {
      setError("Type the role you want first.");
      return;
    }
    setSuggesting(true);
    setError("");
    try {
      const result = await apiFetch<{
        targetRoles: TargetRolesPreference;
      }>("/api/profile/suggest-target-roles", {
        method: "POST",
        body: JSON.stringify({ primary: p }),
      });
      const tr = result.targetRoles;
      setPrimary(tr.primary);
      setSuggested(tr.suggested);
      setEnabled(tr.enabled);
      setSuggestedAt(tr.suggestedAt);
      // Endpoint already saved; refresh parent profile state.
      await onSave({ targetRoles: tr });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggest failed");
    } finally {
      setSuggesting(false);
    }
  }

  async function handlePrimaryBlur() {
    const p = primary.trim();
    const prev = saved?.primary?.trim() ?? "";
    if (p === prev && JSON.stringify(enabled) === JSON.stringify(saved?.enabled ?? [])) {
      return;
    }
    // Auto-enable primary when first typed / changed.
    let nextEnabled = enabled;
    if (p && !enabled.some((e) => normKey(e) === normKey(p))) {
      nextEnabled = [p, ...enabled.filter((e) => normKey(e) !== normKey(prev))].slice(
        0,
        3
      );
      setEnabled(nextEnabled);
    } else if (prev && p !== prev) {
      nextEnabled = enabled.map((e) =>
        normKey(e) === normKey(prev) ? p : e
      );
      setEnabled(nextEnabled);
    }
    await persist({
      primary: p,
      suggested: p === prev ? suggested : [],
      enabled: nextEnabled,
      ...(p === prev && suggestedAt ? { suggestedAt } : {}),
    });
    if (p !== prev) {
      setSuggested([]);
      setSuggestedAt(undefined);
    }
  }

  const inferred = candidate?.inferredRoles ?? [];

  return (
    <div className="mt-6 border-t border-zinc-100 pt-4">
      <h4 className="text-sm font-medium text-zinc-900">Roles I want to search</h4>
      <p className="mt-1 text-xs text-zinc-500">
        Type your target role, then suggest related titles. Checked roles become
        search queries (up to 3 of 4). The 4th query stays an AI stretch.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="target-primary">Primary target role</Label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="target-primary"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              onBlur={() => void handlePrimaryBlur()}
              placeholder="e.g. Logistiek Planner"
              className="sm:flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={suggesting || !primary.trim()}
              onClick={() => void handleSuggest()}
            >
              {suggesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="ml-1.5">Suggest related</span>
            </Button>
          </div>
          {inferred.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {inferred.slice(0, 6).map((r) => (
                <button
                  key={r.role}
                  type="button"
                  className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200"
                  onClick={() => {
                    setPrimary(r.role);
                    const nextEnabled = [r.role].slice(0, 3);
                    setEnabled(nextEnabled);
                    setSuggested([]);
                    setSuggestedAt(undefined);
                    void persist({
                      primary: r.role,
                      suggested: [],
                      enabled: nextEnabled,
                    });
                  }}
                >
                  Use: {r.role}
                </button>
              ))}
            </div>
          )}
        </div>

        {(primary.trim() || suggested.length > 0) && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-zinc-600">
              Search these roles ({enabled.length}/3)
            </legend>
            {primary.trim() && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-zinc-300"
                  checked={enabled.some((e) => normKey(e) === normKey(primary))}
                  onChange={() => toggleEnabled(primary.trim())}
                />
                <span>
                  <span className="font-medium">{primary.trim()}</span>
                  <span className="ml-1.5 text-xs text-zinc-400">primary</span>
                </span>
              </label>
            )}
            {suggested.map((s) => (
              <label key={s.role} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-zinc-300"
                  checked={enabled.some((e) => normKey(e) === normKey(s.role))}
                  onChange={() => toggleEnabled(s.role)}
                />
                <span className="min-w-0">
                  <span className="font-medium">{s.role}</span>
                  <span className="ml-1.5 text-xs text-zinc-400">
                    {s.relatedness}
                    {s.searchQuery && s.searchQuery !== s.role
                      ? ` · “${s.searchQuery}”`
                      : ""}
                  </span>
                  {s.hireabilityNote && (
                    <span className="mt-0.5 block text-xs text-amber-700">
                      {s.hireabilityNote}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">Steep jump warning</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="mt-1 text-amber-800/80">
              We&apos;ll still search checked roles; matching may hide unfit
              listings.
            </p>
          </div>
        )}

        {(saving || error) && (
          <p
            className={`text-xs ${error ? "text-red-600" : "text-zinc-400"}`}
          >
            {error || "Saved"}
          </p>
        )}
      </div>
    </div>
  );
}
