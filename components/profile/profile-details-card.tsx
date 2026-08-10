"use client";

import { useEffect, useRef, useState } from "react";
import type { UserProfile } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  profileToIdentityForm,
  identityFormToUpdate,
  type IdentityFormValues,
} from "./profile-form";
import { RESUME_ACCEPT, resumeFileTypeLabel } from "@/lib/resume/files";

const AUTOSAVE_MS = 700;

export interface ProfileResumeProps {
  hasRawResume: boolean;
  hasAiSummary: boolean;
  linkedInIngested?: boolean;
  uploading: boolean;
  downloading: boolean;
  deleting: boolean;
  onUpload: (file: File | null) => void;
  onDownload: () => void;
  onDelete: () => void;
}

export interface ProfileCoverLettersProps {
  uploading: boolean;
  deletingId: string | null;
  onUpload: (file: File | null) => void;
  onDelete: (id: string) => void;
}

interface ProfileDetailsCardProps {
  profile: UserProfile;
  phoneDisplay?: string;
  isProcessing?: boolean;
  onSave: (update: Partial<UserProfile>) => Promise<void>;
  resume?: ProfileResumeProps;
  coverLetters?: ProfileCoverLettersProps;
}

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export function ProfileDetailsCard({
  profile,
  phoneDisplay,
  isProcessing,
  onSave,
  resume,
  coverLetters,
}: ProfileDetailsCardProps) {
  const [form, setForm] = useState<IdentityFormValues>(() =>
    profileToIdentityForm(profile, phoneDisplay)
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const lastSavedJson = useRef(
    JSON.stringify(identityFormToUpdate(form, profile))
  );
  const profileRef = useRef(profile);
  const onSaveRef = useRef(onSave);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextProfileSync = useRef(false);

  profileRef.current = profile;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (skipNextProfileSync.current) {
      skipNextProfileSync.current = false;
      const next = profileToIdentityForm(profile, phoneDisplay);
      lastSavedJson.current = JSON.stringify(
        identityFormToUpdate(next, profile)
      );
      return;
    }
    const next = profileToIdentityForm(profile, phoneDisplay);
    setForm(next);
    lastSavedJson.current = JSON.stringify(
      identityFormToUpdate(next, profile)
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

    const update = identityFormToUpdate(form, current);
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

  function update(field: keyof IdentityFormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
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

  const resumeBusy =
    !!resume &&
    (resume.uploading ||
      resume.downloading ||
      resume.deleting ||
      !!isProcessing);

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <CardTitle>Profile details</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Who you are — contact, resume, cover-letter samples, languages, and
            links. Job search prefs live under Career intent.
          </p>
        </div>
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
        <div>
          <Label htmlFor="edit-languages">Languages spoken</Label>
          <Input
            id="edit-languages"
            value={form.languagesSpoken}
            onChange={(e) => update("languagesSpoken", e.target.value)}
            placeholder="English, Dutch"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Comma-separated. Jobs that require a language you do not speak will
            be hidden.
          </p>
        </div>

        {resume && (
          <div className="sm:col-span-2 border-t border-zinc-100 pt-4">
            <p className="text-sm font-medium text-zinc-900">Resume</p>
            <p className="text-xs text-zinc-500">
              Upload a CV anytime — AI re-extracts skills and your career
              ladder.
            </p>

            {profile.resume ? (
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
                  <div className="text-sm">
                    <p className="font-medium">{profile.resume.fileName}</p>
                    <p className="text-zinc-500">
                      Uploaded{" "}
                      {new Date(profile.resume.uploadedAt).toLocaleDateString()}
                    </p>
                    {resume.hasRawResume && (
                      <p className="mt-1 text-emerald-600">
                        Resume text ingested
                      </p>
                    )}
                    {resume.hasAiSummary && (
                      <p className="text-violet-600">AI summary available</p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 self-start">
                  <Button
                    variant="ghost"
                    className="px-2 text-zinc-500 hover:text-zinc-900"
                    disabled={resumeBusy}
                    onClick={() => resume.onDownload()}
                    aria-label="Download resume"
                  >
                    {resume.downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 text-zinc-500 hover:text-red-600"
                    disabled={resumeBusy}
                    onClick={() => resume.onDelete()}
                    aria-label="Remove resume"
                  >
                    {resume.deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No resume uploaded</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  accept={RESUME_ACCEPT}
                  disabled={resumeBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    resume.onUpload(file);
                  }}
                />
                <span
                  className={`inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition-colors ${
                    resumeBusy
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-zinc-50"
                  }`}
                >
                  {resume.uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {resume.uploading
                    ? "Uploading…"
                    : profile.resume
                      ? "Replace resume"
                      : "Upload resume"}
                </span>
              </label>
              <p className="text-xs text-zinc-400">{resumeFileTypeLabel()}</p>
            </div>
          </div>
        )}

        {coverLetters && (
          <div className="sm:col-span-2 border-t border-zinc-100 pt-4">
            <p className="text-sm font-medium text-zinc-900">Cover letters</p>
            <p className="text-xs text-zinc-500">
              Past letters as style references — AI writes a new one per job
              using your voice, not a copy of these samples.
            </p>

            <div className="mt-3 space-y-2">
              {(profile.coverLetters ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No cover letter samples yet
                </p>
              ) : (
                <ul className="space-y-2">
                  {(profile.coverLetters ?? []).map((letter) => (
                    <li
                      key={letter.id}
                      className="flex flex-col gap-2 rounded-lg border border-zinc-100 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-medium">
                            {letter.fileName}
                          </p>
                          <p className="text-zinc-500">
                            Uploaded{" "}
                            {new Date(letter.uploadedAt).toLocaleDateString()}
                            {letter.rawText?.trim()
                              ? " · text ready"
                              : " · text extraction pending"}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        className="shrink-0 px-2 text-zinc-500 hover:text-red-600"
                        disabled={coverLetters.deletingId === letter.id}
                        onClick={() => coverLetters.onDelete(letter.id)}
                        aria-label={`Remove ${letter.fileName}`}
                      >
                        {coverLetters.deletingId === letter.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept={RESUME_ACCEPT}
                    disabled={
                      coverLetters.uploading ||
                      (profile.coverLetters?.length ?? 0) >= 5
                    }
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      coverLetters.onUpload(file);
                    }}
                  />
                  <span
                    className={`inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition-colors ${
                      coverLetters.uploading ||
                      (profile.coverLetters?.length ?? 0) >= 5
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    {coverLetters.uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {coverLetters.uploading
                      ? "Uploading…"
                      : "Upload cover letter"}
                  </span>
                </label>
                <p className="text-xs text-zinc-400">PDF or Word · up to 5</p>
              </div>
            </div>
          </div>
        )}

        <div className="sm:col-span-2 border-t border-zinc-100 pt-4">
          <p className="text-sm font-medium text-zinc-900">Links &amp; sites</p>
          <p className="text-xs text-zinc-500">
            Used to enrich your profile when we analyze LinkedIn and portfolios.
          </p>
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
          {form.linkedInUrl.trim() && resume && (
            <p
              className={`mt-1 text-xs ${
                resume.linkedInIngested ? "text-emerald-600" : "text-amber-700"
              }`}
            >
              {resume.linkedInIngested
                ? "LinkedIn profile ingested — used for job matching"
                : "Not ingested yet — click Re-analyze (sign in via Apply once if LinkedIn blocks guests)"}
            </p>
          )}
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
