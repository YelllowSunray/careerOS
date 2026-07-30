"use client";

import { useEffect, useRef, useState } from "react";
import type { UserProfile, WorkArrangement } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  profileToFormValues,
  formValuesToProfileUpdate,
  type ProfileFormValues,
} from "./profile-form";
import {
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  toggleWorkArrangement,
} from "@/lib/job-search/work-preference";

const AUTOSAVE_MS = 700;

interface ProfileDetailsCardProps {
  profile: UserProfile;
  phoneDisplay?: string;
  isProcessing?: boolean;
  onSave: (update: Partial<UserProfile>) => Promise<void>;
}

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export function ProfileDetailsCard({
  profile,
  phoneDisplay,
  isProcessing,
  onSave,
}: ProfileDetailsCardProps) {
  const [form, setForm] = useState<ProfileFormValues>(() =>
    profileToFormValues(profile, phoneDisplay)
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const lastSavedJson = useRef(
    JSON.stringify(formValuesToProfileUpdate(form, profile))
  );
  const profileRef = useRef(profile);
  const onSaveRef = useRef(onSave);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextProfileSync = useRef(false);

  profileRef.current = profile;
  onSaveRef.current = onSave;

  // Sync from server when profile changes (except right after our own save).
  useEffect(() => {
    if (skipNextProfileSync.current) {
      skipNextProfileSync.current = false;
      const next = profileToFormValues(profile, phoneDisplay);
      lastSavedJson.current = JSON.stringify(
        formValuesToProfileUpdate(next, profile)
      );
      return;
    }
    const next = profileToFormValues(profile, phoneDisplay);
    setForm(next);
    lastSavedJson.current = JSON.stringify(
      formValuesToProfileUpdate(next, profile)
    );
    setStatus("idle");
    setSaveError("");
  }, [profile, phoneDisplay]);

  useEffect(() => {
    const current = profileRef.current;
    if (!form.name.trim() || !form.email.trim()) {
      setStatus((s) => (s === "saving" ? s : "dirty"));
      return;
    }

    const update = formValuesToProfileUpdate(form, current);
    const json = JSON.stringify(update);
    if (json === lastSavedJson.current) {
      return;
    }

    setStatus("dirty");
    setSaveError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      void (async () => {
        setStatus("saving");
        try {
          skipNextProfileSync.current = true;
          await onSaveRef.current(update);
          lastSavedJson.current = json;
          setStatus("saved");
        } catch (e) {
          skipNextProfileSync.current = false;
          console.error("[Profile] Autosave failed:", e);
          setSaveError(e instanceof Error ? e.message : "Save failed");
          setStatus("error");
        }
      })();
    }, AUTOSAVE_MS);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [form]);

  function update(field: keyof ProfileFormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleWorkPreference(arrangement: WorkArrangement) {
    setForm((prev) => ({
      ...prev,
      workPreferences: toggleWorkArrangement(prev.workPreferences, arrangement),
    }));
  }

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "dirty"
          ? "Unsaved changes"
          : status === "error"
            ? "Couldn’t save"
            : isProcessing
              ? "Extracting…"
              : "Autosave on";

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <CardTitle>Profile details</CardTitle>
        <p
          className={`flex items-center gap-1.5 text-xs font-medium ${
            status === "error"
              ? "text-red-600"
              : status === "saved"
                ? "text-emerald-700"
                : status === "dirty" || status === "saving"
                  ? "text-zinc-600"
                  : "text-zinc-400"
          }`}
          aria-live="polite"
        >
          {status === "saving" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {statusLabel}
        </p>
      </div>
      {saveError && (
        <p className="mt-2 text-xs text-red-600">{saveError}</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="edit-name">Name</Label>
          <Input
            id="edit-name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="edit-email">Email</Label>
          <Input
            id="edit-email"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="edit-phone">Phone</Label>
          <Input
            id="edit-phone"
            value={form.phoneNumber}
            onChange={(e) => update("phoneNumber", e.target.value)}
            placeholder="+31 6 12345678"
            className="mt-1"
          />
          {!form.phoneNumber && isProcessing && (
            <p className="mt-1 text-xs text-zinc-500">Extracting from resume…</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <Label>Work preference</Label>
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
            Select all that apply. Leave all unchecked if you are open to any.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="edit-languages">Languages spoken</Label>
          <Input
            id="edit-languages"
            value={form.languagesSpoken}
            onChange={(e) => update("languagesSpoken", e.target.value)}
            placeholder="English, Dutch"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Comma-separated. Jobs that require a language you do not speak will be
            hidden.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="edit-home">Home base (for commute)</Label>
          <Input
            id="edit-home"
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
                  commuteNoLimit: e.target.checked ? false : prev.commuteNoLimit,
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
                Only show jobs located in your home-base city
                {form.homeLocation.trim()
                  ? ` (${form.homeLocation.trim().split(",")[0]?.trim()})`
                  : ""}
                . Other cities and remote elsewhere are hidden.
              </span>
            </span>
          </label>
        </div>
        <div>
          <Label htmlFor="edit-commute-mode">Commute mode</Label>
          <select
            id="edit-commute-mode"
            value={form.commuteMode}
            onChange={(e) => update("commuteMode", e.target.value)}
            disabled={form.commuteHomeBaseOnly}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base disabled:bg-zinc-50 disabled:text-zinc-400 sm:py-2 sm:text-sm"
          >
            <option value="">Not set</option>
            <option value="car">Car</option>
            <option value="bike">Bike</option>
            <option value="public_transit">Public transport</option>
            <option value="walk">Walking</option>
          </select>
        </div>
        <div>
          <Label htmlFor="edit-commute-max">Max one-way commute</Label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="edit-commute-max"
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
          <p className="mt-1 text-xs text-zinc-500">
            {form.commuteHomeBaseOnly
              ? "Home base only is on — commute minutes are not used."
              : "Jobs beyond this one-way commute are hidden. Set home + mode + minutes, or choose no limit."}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="edit-job-prefs">What type of job do you want?</Label>
          <textarea
            id="edit-job-prefs"
            value={form.jobPreferences}
            onChange={(e) => update("jobPreferences", e.target.value)}
            placeholder="e.g. Full-time, remote, frontend roles in the Netherlands. Open to hybrid in Amsterdam."
            rows={3}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base sm:py-2 sm:text-sm"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Used by AI during job search and matching — employment type, location,
            remote policy, industry, seniority, etc.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="edit-country">
            Country (used for LinkedIn & Indeed job search)
          </Label>
          <Input
            id="edit-country"
            value={form.preferredCountry}
            onChange={(e) => update("preferredCountry", e.target.value)}
            placeholder="Netherlands"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="edit-linkedin">LinkedIn URL</Label>
          <Input
            id="edit-linkedin"
            value={form.linkedInUrl}
            onChange={(e) => update("linkedInUrl", e.target.value)}
            placeholder="https://linkedin.com/in/..."
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="edit-github">GitHub URL</Label>
          <Input
            id="edit-github"
            value={form.githubUrl}
            onChange={(e) => update("githubUrl", e.target.value)}
            placeholder="https://github.com/..."
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="edit-portfolios">
            Portfolio sites (comma-separated)
          </Label>
          <Input
            id="edit-portfolios"
            value={form.portfolioUrls}
            onChange={(e) => update("portfolioUrls", e.target.value)}
            placeholder="samirdev.com, portfoliosamir.com"
            className="mt-1"
          />
        </div>
      </div>
    </Card>
  );
}
