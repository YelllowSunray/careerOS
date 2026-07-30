"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useApi } from "@/lib/hooks/use-api";
import { RESUME_ACCEPT, isAllowedResumeFile, resumeFileTypeLabel } from "@/lib/resume/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import { normalizePreferredCountries } from "@/lib/job-search/countries";
import { parseLanguagesSpoken } from "@/components/profile/profile-form";
import { parseCommuteMaxMinutesFromForm } from "@/lib/commute/helpers";
import type { WorkArrangement } from "@/lib/types";
import {
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  toggleWorkArrangement,
} from "@/lib/job-search/work-preference";

export default function OnboardingPage() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [portfolioUrls, setPortfolioUrls] = useState("");
  const [preferredCountry, setPreferredCountry] = useState("");
  const [workPreferences, setWorkPreferences] = useState<WorkArrangement[]>([]);
  const [jobPreferences, setJobPreferences] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState("English");
  const [homeLocation, setHomeLocation] = useState("");
  const [commuteMode, setCommuteMode] = useState("");
  const [commuteMaxMinutes, setCommuteMaxMinutes] = useState("");
  const [commuteNoLimit, setCommuteNoLimit] = useState(false);
  const [commuteHomeBaseOnly, setCommuteHomeBaseOnly] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState("");

  function handleResumeChange(file: File | null) {
    if (!file) {
      setResumeFile(null);
      setResumeError("");
      return;
    }
    if (!isAllowedResumeFile(file.name)) {
      setResumeFile(null);
      setResumeError(`Please upload a ${resumeFileTypeLabel()}.`);
      return;
    }
    setResumeError("");
    setResumeFile(file);
  }

  async function handleComplete() {
    setLoading(true);
    setError("");
    try {
      const parsedCommuteMax = parseCommuteMaxMinutesFromForm(
        commuteMaxMinutes,
        commuteNoLimit,
        commuteHomeBaseOnly
      );
      const commutePayload =
        homeLocation.trim() && (commuteHomeBaseOnly || commuteMode)
          ? {
              homeLocation: homeLocation.trim(),
              ...(commuteMode ? { commuteMode } : {}),
              commuteMaxMinutes: parsedCommuteMax ?? null,
            }
          : {};

      await apiFetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          name,
          email,
          phoneNumber: phoneNumber || undefined,
          linkedInUrl: linkedInUrl || undefined,
          githubUrl: githubUrl || undefined,
          portfolioUrls: portfolioUrls
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean),
          preferredCountries: normalizePreferredCountries(preferredCountry),
          workPreferences,
          jobPreferences: jobPreferences.trim() || undefined,
          languagesSpoken: parseLanguagesSpoken(languagesSpoken),
          ...commutePayload,
          onboardingComplete: true,
        }),
      });

      if (resumeFile) {
        const formData = new FormData();
        formData.append("file", resumeFile);
        await apiFetch("/api/resume/upload", {
          method: "POST",
          body: formData,
        });
      }

      await apiFetch("/api/profile/process", { method: "POST", body: JSON.stringify({}) });
      router.push("/profile");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Onboarding failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Card>
        <CardTitle>Set up your profile</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          Step {step} of 3 — Tell us about yourself so the AI can find the right jobs.
        </p>

        {step === 1 && (
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 555 123 4567"
              />
            </div>
            <div>
              <Label htmlFor="linkedin">LinkedIn URL</Label>
              <Input id="linkedin" value={linkedInUrl} onChange={(e) => setLinkedInUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div>
              <Label htmlFor="github">GitHub URL</Label>
              <Input id="github" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/..." />
            </div>
            <Button onClick={() => setStep(2)} disabled={!name || !email}>
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="portfolios">Portfolio URLs (comma-separated)</Label>
              <Input
                id="portfolios"
                value={portfolioUrls}
                onChange={(e) => setPortfolioUrls(e.target.value)}
                placeholder="samirdev.com, portfoliosamir.com"
              />
            </div>
            <div>
              <Label htmlFor="country">Country (for job search on LinkedIn & Indeed)</Label>
              <Input
                id="country"
                value={preferredCountry}
                onChange={(e) => setPreferredCountry(e.target.value)}
                placeholder="Netherlands"
                required
              />
            </div>
            <div>
              <Label>Work preference</Label>
              <div className="mt-2 flex flex-wrap gap-3">
                {WORK_ARRANGEMENTS.map((arrangement) => (
                  <label
                    key={arrangement}
                    className="inline-flex items-center gap-2 text-sm text-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={workPreferences.includes(arrangement)}
                      onChange={() =>
                        setWorkPreferences((prev) =>
                          toggleWorkArrangement(prev, arrangement)
                        )
                      }
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
            <div>
              <Label htmlFor="languages">Languages spoken</Label>
              <Input
                id="languages"
                value={languagesSpoken}
                onChange={(e) => setLanguagesSpoken(e.target.value)}
                placeholder="English, Dutch"
                required
              />
              <p className="mt-1 text-xs text-zinc-500">
                Comma-separated. Jobs that require a language you do not speak will not be shown.
              </p>
            </div>
            <div>
              <Label htmlFor="home">Home base (for commute)</Label>
              <Input
                id="home"
                value={homeLocation}
                onChange={(e) => setHomeLocation(e.target.value)}
                placeholder="Baarn, Netherlands"
              />
              <label className="mt-2 flex items-start gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={commuteHomeBaseOnly}
                  onChange={(e) => {
                    setCommuteHomeBaseOnly(e.target.checked);
                    if (e.target.checked) {
                      setCommuteNoLimit(false);
                      setCommuteMaxMinutes("");
                    }
                  }}
                  className="mt-0.5 rounded border-zinc-300"
                />
                <span>
                  <span className="font-medium">Home base only</span>
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    Only show jobs in your home-base city (not other cities or remote elsewhere).
                  </span>
                </span>
              </label>
            </div>
            <div>
              <Label htmlFor="commute-mode">Commute mode</Label>
              <select
                id="commute-mode"
                value={commuteMode}
                onChange={(e) => setCommuteMode(e.target.value)}
                disabled={commuteHomeBaseOnly}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                <option value="">Not set</option>
                <option value="car">Car</option>
                <option value="bike">Bike</option>
                <option value="public_transit">Public transport</option>
                <option value="walk">Walking</option>
              </select>
            </div>
            <div>
              <Label htmlFor="commute-max">Max one-way commute (minutes)</Label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="commute-max"
                  type="number"
                  min={1}
                  value={commuteMaxMinutes}
                  onChange={(e) => setCommuteMaxMinutes(e.target.value)}
                  placeholder="30"
                  disabled={commuteNoLimit || commuteHomeBaseOnly}
                  className="sm:max-w-[8rem]"
                />
                <label className="flex items-center gap-2 text-sm text-zinc-600">
                  <input
                    type="checkbox"
                    checked={commuteNoLimit}
                    disabled={commuteHomeBaseOnly}
                    onChange={(e) => {
                      setCommuteNoLimit(e.target.checked);
                      if (e.target.checked) {
                        setCommuteMaxMinutes("");
                        setCommuteHomeBaseOnly(false);
                      }
                    }}
                    className="rounded border-zinc-300"
                  />
                  No limit
                </label>
              </div>
              {commuteHomeBaseOnly && (
                <p className="mt-1 text-xs text-zinc-500">
                  Home base only is on — commute minutes are not used.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="job-prefs">What type of job do you want?</Label>
              <textarea
                id="job-prefs"
                value={jobPreferences}
                onChange={(e) => setJobPreferences(e.target.value)}
                placeholder="e.g. Full-time, remote, frontend roles in the Netherlands"
                rows={3}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base sm:py-2 sm:text-sm"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Employment type, location, remote policy, industry — AI uses this when searching and scoring jobs.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!preferredCountry || parseLanguagesSpoken(languagesSpoken).length === 0}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="resume">Resume ({resumeFileTypeLabel()})</Label>
              <Input
                id="resume"
                type="file"
                accept={RESUME_ACCEPT}
                onChange={(e) => handleResumeChange(e.target.files?.[0] ?? null)}
              />
              {resumeError && (
                <p className="mt-1 text-sm text-red-600">{resumeError}</p>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={handleComplete} disabled={loading}>
                {loading ? "Processing..." : "Complete setup"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
