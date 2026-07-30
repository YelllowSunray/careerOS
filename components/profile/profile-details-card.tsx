"use client";

import { useState } from "react";
import type { UserProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import { normalizeUrl } from "@/lib/utils/url";
import { Globe, Pencil } from "lucide-react";
import {
  profileToFormValues,
  formValuesToProfileUpdate,
  type ProfileFormValues,
} from "./profile-form";
import { commuteModeLabel } from "@/lib/commute/helpers";

interface ProfileDetailsCardProps {
  profile: UserProfile;
  phoneDisplay?: string;
  isProcessing?: boolean;
  onSave: (update: Partial<UserProfile>) => Promise<void>;
}

export function ProfileDetailsCard({
  profile,
  phoneDisplay,
  isProcessing,
  onSave,
}: ProfileDetailsCardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileFormValues>(() =>
    profileToFormValues(profile, phoneDisplay)
  );

  const phone = profile.phoneNumber ?? phoneDisplay;

  function startEdit() {
    setForm(profileToFormValues(profile, phoneDisplay));
    setEditing(true);
  }

  function cancelEdit() {
    setForm(profileToFormValues(profile, phoneDisplay));
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(formValuesToProfileUpdate(form, profile));
      setEditing(false);
    } catch (e) {
      console.error("[Profile] Save failed:", e);
    } finally {
      setSaving(false);
    }
  }

  function update(field: keyof ProfileFormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <CardTitle>Profile details</CardTitle>
        {!editing ? (
          <Button variant="ghost" className="self-start text-sm sm:self-auto" onClick={startEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.email}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      {!editing ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-zinc-500">Name</dt>
            <dd className="mt-1 text-sm">{profile.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Email</dt>
            <dd className="mt-1 text-sm">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Phone</dt>
            <dd className="mt-1 text-sm">
              {phone ?? (isProcessing ? "Extracting..." : "—")}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Work preference</dt>
            <dd className="mt-1 text-sm capitalize">{profile.workPreference}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-zinc-500">Languages spoken</dt>
            <dd className="mt-1 text-sm">
              {(profile.languagesSpoken ?? []).length > 0
                ? profile.languagesSpoken!.join(", ")
                : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-zinc-500">Commute</dt>
            <dd className="mt-1 text-sm">
              {profile.homeLocation && profile.commuteMode ? (
                <>
                  From {profile.homeLocation} by {commuteModeLabel(profile.commuteMode)}
                  {profile.commuteMaxMinutes === null
                    ? " · no time limit"
                    : typeof profile.commuteMaxMinutes === "number"
                      ? ` · max ${profile.commuteMaxMinutes} min one-way`
                      : ""}
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-zinc-500">Job preferences</dt>
            <dd className="mt-1 text-sm whitespace-pre-wrap">
              {profile.jobPreferences?.trim() || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Country</dt>
            <dd className="mt-1 text-sm">
              {profile.preferredCountries[0] ?? "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">LinkedIn</dt>
            <dd className="mt-1 text-sm">
              {profile.linkedInUrl ? (
                <a
                  href={normalizeUrl(profile.linkedInUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all"
                >
                  {profile.linkedInUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">GitHub</dt>
            <dd className="mt-1 text-sm">
              {profile.githubUrl ? (
                <a
                  href={normalizeUrl(profile.githubUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all"
                >
                  {profile.githubUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-zinc-500">Portfolio sites</dt>
            <dd className="mt-1">
              {profile.portfolioUrls.length > 0 ? (
                <ul className="space-y-1">
                  {profile.portfolioUrls.map((url) => (
                    <li key={url} className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4 shrink-0 text-zinc-400" />
                      <a
                        href={normalizeUrl(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline break-all"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm">—</span>
              )}
            </dd>
          </div>
        </dl>
      ) : (
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
          </div>
          <div>
            <Label htmlFor="edit-work">Work preference</Label>
            <select
              id="edit-work"
              value={form.workPreference}
              onChange={(e) =>
                update("workPreference", e.target.value)
              }
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base sm:py-2 sm:text-sm"
            >
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
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
              Comma-separated. Jobs that require a language you do not speak will be hidden.
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
          </div>
          <div>
            <Label htmlFor="edit-commute-mode">Commute mode</Label>
            <select
              id="edit-commute-mode"
              value={form.commuteMode}
              onChange={(e) => update("commuteMode", e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base sm:py-2 sm:text-sm"
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
                disabled={form.commuteNoLimit}
                className="sm:max-w-[8rem]"
              />
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={form.commuteNoLimit}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      commuteNoLimit: e.target.checked,
                      commuteMaxMinutes: e.target.checked ? "" : prev.commuteMaxMinutes,
                    }))
                  }
                  className="rounded border-zinc-300"
                />
                No limit
              </label>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Jobs requiring regular on-site attendance beyond this commute will be hidden. Set home + mode + minutes, or choose no limit.
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
              Used by AI during job search and matching — employment type, location, remote policy, industry, seniority, etc.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="edit-country">Country (used for LinkedIn & Indeed job search)</Label>
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
            <Label htmlFor="edit-portfolios">Portfolio sites (comma-separated)</Label>
            <Input
              id="edit-portfolios"
              value={form.portfolioUrls}
              onChange={(e) => update("portfolioUrls", e.target.value)}
              placeholder="samirdev.com, portfoliosamir.com"
              className="mt-1"
            />
          </div>
        </div>
      )}
    </Card>
  );
}
