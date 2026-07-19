"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import {
  API_JOB_BOARDS,
  PLAYWRIGHT_JOB_BOARDS,
  type JobBoard,
  type UserProfile,
} from "@/lib/types";

const SOCIAL_BOARDS: { id: JobBoard; label: string; hint: string }[] = [
  {
    id: "linkedin",
    label: "LinkedIn Jobs",
    hint: "Playwright + AI — guest API when available, no LinkedIn API key needed",
  },
  {
    id: "indeed",
    label: "Indeed",
    hint: "Playwright + AI — browses Indeed search results, no API",
  },
];

const API_BOARDS: { id: JobBoard; label: string; hint: string }[] = [
  { id: "remotive", label: "Remotive", hint: "Remote jobs API" },
  { id: "arbeitnow", label: "Arbeitnow", hint: "Remote & EU jobs API" },
  { id: "remoteok", label: "RemoteOK", hint: "Remote jobs API" },
  { id: "adzuna", label: "Adzuna", hint: "Requires ADZUNA_APP_ID + ADZUNA_APP_KEY in .env.local" },
];

function linesToUrls(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function urlsToLines(urls?: string[]): string {
  return (urls ?? []).join("\n");
}

type BoardState = Record<JobBoard, boolean>;

function boardsToState(boards: JobBoard[]): BoardState {
  return {
    linkedin: boards.includes("linkedin"),
    indeed: boards.includes("indeed"),
    remotive: boards.includes("remotive"),
    arbeitnow: boards.includes("arbeitnow"),
    remoteok: boards.includes("remoteok"),
    adzuna: boards.includes("adzuna"),
  };
}

export default function SettingsPage() {
  const { apiFetch } = useApi();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [threshold, setThreshold] = useState(85);
  const [autoApply, setAutoApply] = useState(false);
  const [jobBoards, setJobBoards] = useState<BoardState>(
    boardsToState(["linkedin", "indeed"])
  );
  const [playwrightUrls, setPlaywrightUrls] = useState("");
  const [careerUrls, setCareerUrls] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/api/profile")
      .then((p: UserProfile) => {
        setProfile(p);
        setThreshold(p?.settings?.fitScoreThreshold ?? 85);
        setAutoApply(p?.settings?.autoApply ?? false);
        const boards = p?.settings?.jobBoards ?? ["linkedin", "indeed"];
        setJobBoards(boardsToState(boards));
        setPlaywrightUrls(urlsToLines(p?.settings?.playwrightJobSearchUrls));
        setCareerUrls(urlsToLines(p?.settings?.careerPageUrls));
      })
      .catch(() => {});
  }, [apiFetch]);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setSaved(false);
    try {
      const allBoards: JobBoard[] = [
        ...PLAYWRIGHT_JOB_BOARDS,
        ...API_JOB_BOARDS,
      ];
      const selectedBoards = allBoards.filter((id) => jobBoards[id]);
      await apiFetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          ...profile,
          settings: {
            fitScoreThreshold: threshold,
            autoApply,
            jobBoards: selectedBoards,
            playwrightJobSearchUrls: linesToUrls(playwrightUrls),
            careerPageUrls: linesToUrls(careerUrls),
          },
        }),
      });
      setSaved(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-zinc-500">Configure your AI career agent</p>
      </div>

      <Card>
        <CardTitle>Application threshold</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          Jobs with a fit score above this threshold will get application materials generated automatically.
        </p>
        <div className="mt-4">
          <Label htmlFor="threshold">Fit score threshold (0–100)</Label>
          <Input
            id="threshold"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="mt-1 max-w-xs"
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            id="autoApply"
            type="checkbox"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
            className="rounded"
          />
          <Label htmlFor="autoApply">Auto-apply to recommended jobs (experimental)</Label>
        </div>
      </Card>

      <Card>
        <CardTitle>Job discovery</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          AI searches job boards using your top 3 inferred roles, then reads each listing against your full resume and portfolio to find ideal matches.
        </p>

        <div className="mt-6 space-y-2">
          <Label>LinkedIn & Indeed (Playwright + AI)</Label>
          <p className="text-sm text-zinc-500">
            No APIs — a browser agent searches these sites and AI extracts matching listings.
          </p>
          <div className="mt-2 space-y-2">
            {SOCIAL_BOARDS.map((board) => (
              <label key={board.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={jobBoards[board.id]}
                  onChange={(e) =>
                    setJobBoards((b) => ({ ...b, [board.id]: e.target.checked }))
                  }
                  className="mt-1 rounded"
                />
                <span>
                  <span className="font-medium">{board.label}</span>
                  <span className="block text-zinc-500">{board.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <Label>Optional job board APIs</Label>
          <div className="mt-2 space-y-2">
            {API_BOARDS.map((board) => (
              <label key={board.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={jobBoards[board.id]}
                  onChange={(e) =>
                    setJobBoards((b) => ({ ...b, [board.id]: e.target.checked }))
                  }
                  className="mt-1 rounded"
                />
                <span>
                  <span className="font-medium">{board.label}</span>
                  <span className="block text-zinc-500">{board.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <Label htmlFor="playwright-urls">Other Playwright + AI search pages</Label>
          <p className="text-sm text-zinc-500">
            Optional. One URL per line, use {"{query}"} for the search term.
          </p>
          <textarea
            id="playwright-urls"
            value={playwrightUrls}
            onChange={(e) => setPlaywrightUrls(e.target.value)}
            placeholder="https://example.com/jobs?q={query}"
            rows={3}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base sm:py-2 sm:text-sm"
          />
        </div>

        <div className="mt-6 space-y-2">
          <Label htmlFor="career-urls">Custom career pages</Label>
          <p className="text-sm text-zinc-500">
            Company career page URLs (one per line). AI crawls and finds job postings.
          </p>
          <textarea
            id="career-urls"
            value={careerUrls}
            onChange={(e) => setCareerUrls(e.target.value)}
            placeholder="https://boards.greenhouse.io/example"
            rows={3}
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base sm:py-2 sm:text-sm"
          />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </Button>
          {saved && <span className="text-sm text-emerald-600">Saved</span>}
        </div>
      </Card>

      <Card>
        <CardTitle>Integrations</CardTitle>
        <p className="mt-2 text-sm text-zinc-500">
          LinkedIn job search is enabled above. Your LinkedIn profile URL on Profile is crawled on Re-analyze and used for job matching alongside your resume and portfolio.
        </p>
      </Card>
    </div>
  );
}
