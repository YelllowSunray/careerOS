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
  const [workPreference, setWorkPreference] = useState("any");
  const [jobPreferences, setJobPreferences] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState("English");
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
          workPreference,
          jobPreferences: jobPreferences.trim() || undefined,
          languagesSpoken: parseLanguagesSpoken(languagesSpoken),
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
    <div className="mx-auto max-w-2xl py-12">
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
              <Label htmlFor="work">Work preference</Label>
              <select
                id="work"
                value={workPreference}
                onChange={(e) => setWorkPreference(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value="any">Any</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
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
              <Label htmlFor="job-prefs">What type of job do you want?</Label>
              <textarea
                id="job-prefs"
                value={jobPreferences}
                onChange={(e) => setJobPreferences(e.target.value)}
                placeholder="e.g. Full-time, remote, frontend roles in the Netherlands"
                rows={3}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
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
