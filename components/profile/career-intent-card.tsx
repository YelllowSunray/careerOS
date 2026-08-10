"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CareerIntent,
  SearchStrategy,
  StretchTolerance,
  UserProfile,
  WorkArrangement,
  WorkSettingPreference,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { seedTargetRolesFromStrategy } from "@/lib/job-search/career-intent";
import {
  jobSearchFormToUpdate,
  profileToJobSearchForm,
  type JobSearchFormValues,
} from "@/components/profile/profile-form";
import {
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  toggleWorkArrangement,
} from "@/lib/job-search/work-preference";

const AUTOSAVE_MS = 700;

type IntentFormState = {
  northStar: string;
  /** Single “what you want” story — saved to narrative + jobPreferences. */
  story: string;
  /** Cliffs — saved to antiGoals + never lane. */
  neverAgain: string;
  workSetting: WorkSettingPreference;
  stretchTolerance: StretchTolerance;
  moneyFloor: string;
  mustHaves: string;
  openQuestions: string;
  horizonNow: string;
  horizonSixMonths: string;
  horizonTwoYears: string;
  dream: string;
  bridge: string;
};

type FormState = IntentFormState &
  Omit<JobSearchFormValues, "jobPreferences">;

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

/** Prefer the longer of two related free-text fields when hydrating a merged UI field. */
function pickStory(narrative?: string, jobPreferences?: string): string {
  const a = narrative?.trim() ?? "";
  const b = jobPreferences?.trim() ?? "";
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  // Same intent often lives in both — keep the richer one.
  return a.length >= b.length ? a : b;
}

function pickNever(
  antiGoals?: string[],
  neverLane?: string[]
): string {
  const a = listToLines(antiGoals);
  const b = listToLines(neverLane);
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  // Union unique tokens
  return listToLines([...linesToList(a), ...linesToList(b)]);
}

function toForm(profile: UserProfile): FormState {
  const i = profile.careerIntent;
  const s = profile.searchStrategy;
  const job = profileToJobSearchForm(profile);
  const { jobPreferences: _drop, ...jobRest } = job;
  return {
    northStar: i?.northStar ?? "",
    story: pickStory(i?.narrative, profile.jobPreferences),
    neverAgain: pickNever(i?.antiGoals, s?.never),
    workSetting: i?.workSetting ?? "flexible",
    stretchTolerance: i?.stretchTolerance ?? "show_stretch",
    moneyFloor: i?.moneyFloor ?? "",
    mustHaves: listToLines(i?.nonNegotiables),
    openQuestions: listToLines(i?.openQuestions),
    horizonNow: listToLines(i?.horizon?.now),
    horizonSixMonths: listToLines(i?.horizon?.sixMonths),
    horizonTwoYears: listToLines(i?.horizon?.twoYears),
    dream: listToLines(s?.dream),
    bridge: listToLines(s?.bridge),
    ...jobRest,
  };
}

function toUpdate(
  form: FormState,
  existing: UserProfile
): Partial<UserProfile> {
  const story = form.story.trim();
  const neverList = linesToList(form.neverAgain);

  const careerIntent: CareerIntent = {
    northStar: form.northStar.trim(),
    narrative: story,
    antiGoals: neverList,
    workSetting: form.workSetting,
    horizon: {
      now: linesToList(form.horizonNow),
      sixMonths: linesToList(form.horizonSixMonths),
      twoYears: linesToList(form.horizonTwoYears),
    },
    stretchTolerance: form.stretchTolerance,
    moneyFloor: form.moneyFloor.trim() || undefined,
    nonNegotiables: linesToList(form.mustHaves),
    openQuestions: linesToList(form.openQuestions),
    updatedAt: new Date().toISOString(),
    source: existing.careerIntent?.source === "intake" ? "intake" : "manual",
  };

  const searchStrategy: SearchStrategy = {
    dream: linesToList(form.dream),
    bridge: linesToList(form.bridge),
    never: neverList,
    confirmedAt: existing.searchStrategy?.confirmedAt ?? new Date().toISOString(),
  };

  const targetRoles = seedTargetRolesFromStrategy(
    searchStrategy,
    existing.targetRoles
  );

  const jobSearch = jobSearchFormToUpdate(
    { ...form, jobPreferences: story },
    existing
  );

  return {
    ...jobSearch,
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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sm:col-span-2 space-y-4 border-t border-zinc-100 pt-5 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
        {hint ? <p className="mt-0.5 text-xs text-zinc-500">{hint}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

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
    const updatePayload = toUpdate(form, current);
    const json = JSON.stringify(updatePayload);
    if (json === lastSavedJson.current) return;

    setStatus("dirty");
    setSaveError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      void (async () => {
        setStatus("saving");
        try {
          skipNextSync.current = true;
          await onSaveRef.current(updatePayload);
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

  function toggleWorkPreference(arrangement: WorkArrangement) {
    setForm((prev) => ({
      ...prev,
      workPreferences: toggleWorkArrangement(prev.workPreferences, arrangement),
    }));
  }

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Career intent &amp; search strategy</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            North star → boundaries → where you work → search lanes. Autosaves.{" "}
            <Link href="/intake" className="underline">
              Continue career conversation
            </Link>
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
              const updatePayload = toUpdate(form, current);
              void (async () => {
                setStatus("saving");
                try {
                  skipNextSync.current = true;
                  await onSaveRef.current(updatePayload);
                  lastSavedJson.current = JSON.stringify(updatePayload);
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

      <div className="mt-5 space-y-1">
        <Section
          title="1. Direction"
          hint="Overall vision (north star) vs the next job you want to land."
        >
          <div className="sm:col-span-2">
            <Label htmlFor="intent-north">North star</Label>
            <Input
              id="intent-north"
              value={form.northStar}
              onChange={(e) => update("northStar", e.target.value)}
              placeholder="e.g. Build and lead high-impact social programs · Become an independent investor"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Your overall vision — where you&apos;re climbing toward, not
              necessarily the job you apply for tomorrow.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="intent-story">Next job you want</Label>
            <textarea
              id="intent-story"
              value={form.story}
              onChange={(e) => update("story", e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              placeholder="e.g. Project officer NGO, full-time, hybrid in NL — a foothold toward that north star…"
            />
            <p className="mt-1 text-xs text-zinc-500">
              The near-term role or step you want next — sector, seniority,
              arrangement, why it moves you toward the star.
            </p>
          </div>
          <div>
            <Label htmlFor="intent-stretch">Stretch appetite</Label>
            <select
              id="intent-stretch"
              value={form.stretchTolerance}
              onChange={(e) =>
                update("stretchTolerance", e.target.value as StretchTolerance)
              }
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="show_stretch">
                Footholds + marked stretch (default)
              </option>
              <option value="dream_aggressive">More dream / stretch</option>
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
        </Section>

        <Section
          title="2. Boundaries"
          hint="Cliffs we must never show — also powers the Never search lane."
        >
          <div className="sm:col-span-2">
            <Label htmlFor="intent-never">Never again</Label>
            <textarea
              id="intent-never"
              value={form.neverAgain}
              onChange={(e) => update("neverAgain", e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-rose-200 bg-rose-50/30 px-3 py-2 text-sm"
              placeholder="e.g. warehouse floor, working for a boss, PA track"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Comma-separated. Hard-excludes these role families from discovery.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="intent-must">Must-haves</Label>
            <Input
              id="intent-must"
              value={form.mustHaves}
              onChange={(e) => update("mustHaves", e.target.value)}
              placeholder="Visa sponsorship, English-only team, 4-day week…"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Soft non-negotiables (not the same as Never — these are requirements
              you want).
            </p>
          </div>
        </Section>

        <Section
          title="3. Where you work"
          hint="Arrangements for boards + day-to-day environment for path scoring."
        >
          <div className="sm:col-span-2">
            <Label>Accepted arrangements</Label>
            <div className="mt-2 flex flex-wrap gap-3">
              {WORK_ARRANGEMENTS.map((arrangement) => (
                <label
                  key={arrangement}
                  className="inline-flex items-center gap-2 text-sm text-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={form.workPreferences.includes(arrangement)}
                    onChange={() => toggleWorkPreference(arrangement)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  {WORK_ARRANGEMENT_LABELS[arrangement]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Remote / hybrid / on-site. Leave all unchecked if open to any.
            </p>
          </div>
          <div>
            <Label htmlFor="intent-setting">Day-to-day environment</Label>
            <select
              id="intent-setting"
              value={form.workSetting}
              onChange={(e) =>
                update("workSetting", e.target.value as WorkSettingPreference)
              }
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="office">Office / desk</option>
              <option value="hybrid">Hybrid desk + remote</option>
              <option value="floor">Floor / warehouse / ops</option>
              <option value="flexible">Flexible (incl. home)</option>
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              Different from remote/hybrid — e.g. office planner vs warehouse
              floor.
            </p>
          </div>
          <div>
            <Label htmlFor="intent-country">Search location</Label>
            <Input
              id="intent-country"
              value={form.preferredCountry}
              onChange={(e) => update("preferredCountry", e.target.value)}
              placeholder="Netherlands — or Everywhere"
              className="mt-1"
            />
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={/^everywhere$/i.test(form.preferredCountry.trim())}
                onChange={(e) =>
                  update(
                    "preferredCountry",
                    e.target.checked ? "Everywhere" : ""
                  )
                }
                className="h-4 w-4 rounded border-zinc-300"
              />
              Everywhere (all countries)
            </label>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="intent-home">Home base</Label>
            <Input
              id="intent-home"
              value={form.homeLocation}
              onChange={(e) => update("homeLocation", e.target.value)}
              placeholder="Baarn, Netherlands"
              className="mt-1"
            />
            <label className="mt-2 flex items-start gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={form.commuteHomeBaseOnly}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    commuteHomeBaseOnly: e.target.checked,
                    commuteNoLimit: e.target.checked
                      ? false
                      : prev.commuteNoLimit,
                    commuteMaxMinutes: e.target.checked
                      ? ""
                      : prev.commuteMaxMinutes,
                  }))
                }
                className="mt-0.5 rounded border-zinc-300"
              />
              <span>
                <span className="font-medium">Home base only</span>
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                  Only jobs in your home-base city
                  {form.homeLocation.trim()
                    ? ` (${form.homeLocation.trim().split(",")[0]?.trim()})`
                    : ""}
                  .
                </span>
              </span>
            </label>
          </div>
          <div>
            <Label htmlFor="intent-commute-mode">Commute mode</Label>
            <select
              id="intent-commute-mode"
              value={form.commuteMode}
              onChange={(e) =>
                update(
                  "commuteMode",
                  e.target.value as JobSearchFormValues["commuteMode"]
                )
              }
              disabled={form.commuteHomeBaseOnly}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
            >
              <option value="">Not set</option>
              <option value="car">Car</option>
              <option value="bike">Bike</option>
              <option value="public_transit">Public transport</option>
              <option value="walk">Walking</option>
            </select>
          </div>
          <div>
            <Label htmlFor="intent-commute-max">Max one-way (minutes)</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="intent-commute-max"
                type="number"
                min={1}
                value={form.commuteMaxMinutes}
                onChange={(e) => update("commuteMaxMinutes", e.target.value)}
                placeholder="30"
                disabled={form.commuteNoLimit || form.commuteHomeBaseOnly}
                className="sm:max-w-[8rem]"
              />
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={form.commuteNoLimit}
                  disabled={form.commuteHomeBaseOnly}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      commuteNoLimit: e.target.checked,
                      commuteHomeBaseOnly: e.target.checked
                        ? false
                        : prev.commuteHomeBaseOnly,
                      commuteMaxMinutes: e.target.checked
                        ? ""
                        : prev.commuteMaxMinutes,
                    }))
                  }
                  className="rounded border-zinc-300"
                />
                No limit
              </label>
            </div>
          </div>
        </Section>

        <Section
          title="4. Search lanes"
          hint="Board-ready role phrases. Never is set from Boundaries above."
        >
          <div>
            <Label htmlFor="lane-dream">Dream</Label>
            <textarea
              id="lane-dream"
              value={form.dream}
              onChange={(e) => update("dream", e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-sm"
              placeholder="Aspiration titles boards understand"
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
              placeholder="Hireable footholds toward the star"
            />
          </div>
          <div className="sm:col-span-2 rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2 text-sm text-zinc-700">
            <span className="font-medium text-rose-900">Never · </span>
            {form.neverAgain.trim() || (
              <span className="text-zinc-400">Same as “Never again” above</span>
            )}
          </div>
        </Section>

        <Section
          title="5. Path over time (optional)"
          hint="Timeline titles — optional; Dream / Bridge above drive most searches."
        >
          <div>
            <Label htmlFor="intent-now">Now</Label>
            <Input
              id="intent-now"
              value={form.horizonNow}
              onChange={(e) => update("horizonNow", e.target.value)}
              placeholder="Near-term titles"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="intent-6m">6–12 months</Label>
            <Input
              id="intent-6m"
              value={form.horizonSixMonths}
              onChange={(e) => update("horizonSixMonths", e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="intent-2y">~2 years</Label>
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
              placeholder="Things you’re still deciding…"
              className="mt-1"
            />
          </div>
        </Section>
      </div>
    </Card>
  );
}
