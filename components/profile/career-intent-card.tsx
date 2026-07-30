"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CareerIntent,
  SearchStrategy,
  StretchTolerance,
  UserProfile,
  WorkSettingPreference,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { seedTargetRolesFromStrategy } from "@/lib/job-search/career-intent";

const AUTOSAVE_MS = 700;

type FormState = {
  northStar: string;
  narrative: string;
  antiGoals: string;
  workSetting: WorkSettingPreference;
  stretchTolerance: StretchTolerance;
  moneyFloor: string;
  nonNegotiables: string;
  openQuestions: string;
  horizonNow: string;
  horizonSixMonths: string;
  horizonTwoYears: string;
  dream: string;
  bridge: string;
  never: string;
};

function linesToList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

function listToLines(list: string[] | undefined): string {
  return (list ?? []).join(", ");
}

function toForm(profile: UserProfile): FormState {
  const i = profile.careerIntent;
  const s = profile.searchStrategy;
  return {
    northStar: i?.northStar ?? "",
    narrative: i?.narrative ?? "",
    antiGoals: listToLines(i?.antiGoals),
    workSetting: i?.workSetting ?? "flexible",
    stretchTolerance: i?.stretchTolerance ?? "show_stretch",
    moneyFloor: i?.moneyFloor ?? "",
    nonNegotiables: listToLines(i?.nonNegotiables),
    openQuestions: listToLines(i?.openQuestions),
    horizonNow: listToLines(i?.horizon?.now),
    horizonSixMonths: listToLines(i?.horizon?.sixMonths),
    horizonTwoYears: listToLines(i?.horizon?.twoYears),
    dream: listToLines(s?.dream),
    bridge: listToLines(s?.bridge),
    never: listToLines(s?.never),
  };
}

function toUpdate(
  form: FormState,
  existing: UserProfile
): Partial<UserProfile> {
  const careerIntent: CareerIntent = {
    northStar: form.northStar.trim(),
    narrative: form.narrative.trim(),
    antiGoals: linesToList(form.antiGoals),
    workSetting: form.workSetting,
    horizon: {
      now: linesToList(form.horizonNow),
      sixMonths: linesToList(form.horizonSixMonths),
      twoYears: linesToList(form.horizonTwoYears),
    },
    stretchTolerance: form.stretchTolerance,
    moneyFloor: form.moneyFloor.trim() || undefined,
    nonNegotiables: linesToList(form.nonNegotiables),
    openQuestions: linesToList(form.openQuestions),
    updatedAt: new Date().toISOString(),
    source: existing.careerIntent?.source === "intake" ? "intake" : "manual",
  };

  const searchStrategy: SearchStrategy = {
    dream: linesToList(form.dream),
    bridge: linesToList(form.bridge),
    never: linesToList(form.never),
    confirmedAt: existing.searchStrategy?.confirmedAt ?? new Date().toISOString(),
  };

  const targetRoles = seedTargetRolesFromStrategy(
    searchStrategy,
    existing.targetRoles
  );

  return {
    careerIntent,
    searchStrategy,
    targetRoles,
    settings: {
      ...existing.settings,
      showStretchTargets: form.stretchTolerance !== "hireable_only",
    },
  };
}

interface CareerIntentCardProps {
  profile: UserProfile;
  onSave: (update: Partial<UserProfile>) => Promise<void>;
}

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export function CareerIntentCard({ profile, onSave }: CareerIntentCardProps) {
  const [form, setForm] = useState<FormState>(() => toForm(profile));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const lastSavedJson = useRef(JSON.stringify(toUpdate(form, profile)));
  const profileRef = useRef(profile);
  const onSaveRef = useRef(onSave);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSync = useRef(false);

  profileRef.current = profile;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      const next = toForm(profile);
      lastSavedJson.current = JSON.stringify(toUpdate(next, profile));
      return;
    }
    const next = toForm(profile);
    setForm(next);
    lastSavedJson.current = JSON.stringify(toUpdate(next, profile));
    setStatus("idle");
    setSaveError("");
  }, [profile]);

  useEffect(() => {
    const current = profileRef.current;
    const update = toUpdate(form, current);
    const json = JSON.stringify(update);
    if (json === lastSavedJson.current) return;

    setStatus("dirty");
    setSaveError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      void (async () => {
        setStatus("saving");
        try {
          skipNextSync.current = true;
          await onSaveRef.current(update);
          lastSavedJson.current = json;
          setStatus("saved");
        } catch (e) {
          skipNextSync.current = false;
          setSaveError(e instanceof Error ? e.message : "Save failed");
          setStatus("error");
        }
      })();
    }, AUTOSAVE_MS);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Career intent &amp; search strategy</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Edit freely — changes autosave and drive Dream / Bridge / Never job
            search. Or{" "}
            <Link href="/intake" className="underline">
              continue the career conversation
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {status === "saving" && (
            <span className="flex items-center gap-1 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
          {status === "saved" && (
            <span className="text-emerald-600">Saved</span>
          )}
          {status === "dirty" && (
            <span className="text-zinc-400">Unsaved changes…</span>
          )}
          {status === "error" && (
            <span className="text-red-600">{saveError || "Save failed"}</span>
          )}
          <button
            type="button"
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-800 hover:bg-zinc-50"
            onClick={() => {
              const current = profileRef.current;
              const update = toUpdate(form, current);
              void (async () => {
                setStatus("saving");
                try {
                  skipNextSync.current = true;
                  await onSaveRef.current(update);
                  lastSavedJson.current = JSON.stringify(update);
                  setStatus("saved");
                } catch (e) {
                  skipNextSync.current = false;
                  setSaveError(e instanceof Error ? e.message : "Save failed");
                  setStatus("error");
                }
              })();
            }}
          >
            Save now
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="intent-north">North star</Label>
          <Input
            id="intent-north"
            value={form.northStar}
            onChange={(e) => update("northStar", e.target.value)}
            placeholder="e.g. Logistiek Planner in an office"
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="intent-narrative">Narrative / hopes</Label>
          <textarea
            id="intent-narrative"
            value={form.narrative}
            onChange={(e) => update("narrative", e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            placeholder="What you want and why…"
          />
        </div>
        <div>
          <Label htmlFor="intent-setting">Work setting</Label>
          <select
            id="intent-setting"
            value={form.workSetting}
            onChange={(e) =>
              update("workSetting", e.target.value as WorkSettingPreference)
            }
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          >
            <option value="office">Office</option>
            <option value="hybrid">Hybrid</option>
            <option value="floor">Floor / on-site ops</option>
            <option value="flexible">Flexible</option>
          </select>
        </div>
        <div>
          <Label htmlFor="intent-stretch">Stretch tolerance</Label>
          <select
            id="intent-stretch"
            value={form.stretchTolerance}
            onChange={(e) =>
              update("stretchTolerance", e.target.value as StretchTolerance)
            }
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          >
            <option value="show_stretch">Show stretch dream matches</option>
            <option value="dream_aggressive">Aggressive dream search</option>
            <option value="hireable_only">Hireable-only (hide stretch)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="intent-money">Money floor</Label>
          <Input
            id="intent-money"
            value={form.moneyFloor}
            onChange={(e) => update("moneyFloor", e.target.value)}
            placeholder="e.g. €2800 / month"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="intent-anti">Anti-goals (never again)</Label>
          <Input
            id="intent-anti"
            value={form.antiGoals}
            onChange={(e) => update("antiGoals", e.target.value)}
            placeholder="Comma-separated"
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="intent-nonneg">Non-negotiables</Label>
          <Input
            id="intent-nonneg"
            value={form.nonNegotiables}
            onChange={(e) => update("nonNegotiables", e.target.value)}
            placeholder="Comma-separated"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="intent-now">Horizon — now</Label>
          <Input
            id="intent-now"
            value={form.horizonNow}
            onChange={(e) => update("horizonNow", e.target.value)}
            placeholder="Roles / titles"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="intent-6m">Horizon — 6–12 months</Label>
          <Input
            id="intent-6m"
            value={form.horizonSixMonths}
            onChange={(e) => update("horizonSixMonths", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="intent-2y">Horizon — ~2 years</Label>
          <Input
            id="intent-2y"
            value={form.horizonTwoYears}
            onChange={(e) => update("horizonTwoYears", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="intent-questions">Open questions</Label>
          <Input
            id="intent-questions"
            value={form.openQuestions}
            onChange={(e) => update("openQuestions", e.target.value)}
            className="mt-1"
          />
        </div>

        <div className="sm:col-span-2 border-t border-zinc-100 pt-4">
          <p className="text-sm font-medium text-zinc-900">Search lanes</p>
          <p className="text-xs text-zinc-500">
            Comma-separated phrases. Dream = aspiration; Bridge = hireable now;
            Never = hard exclude from search.
          </p>
        </div>
        <div>
          <Label htmlFor="lane-dream">Dream</Label>
          <textarea
            id="lane-dream"
            value={form.dream}
            onChange={(e) => update("dream", e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="lane-bridge">Bridge</Label>
          <textarea
            id="lane-bridge"
            value={form.bridge}
            onChange={(e) => update("bridge", e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-sky-200 bg-sky-50/40 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="lane-never">Never</Label>
          <textarea
            id="lane-never"
            value={form.never}
            onChange={(e) => update("never", e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-rose-200 bg-rose-50/40 px-3 py-2 text-sm"
          />
        </div>
      </div>
    </Card>
  );
}
