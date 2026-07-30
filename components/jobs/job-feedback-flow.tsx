"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { FeedbackReviewResult } from "@/lib/types";
import type { Job } from "@/lib/types";

const HINTS = [
  "Too senior",
  "Too junior",
  "Wrong craft / field",
  "Location / commute",
  "Pay / benefits",
  "Company stage / size",
  "Other",
] as const;

interface JobFeedbackFlowProps {
  job: Job;
  apiFetch: (url: string, init?: RequestInit) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}

export function JobFeedbackFlow({
  job,
  apiFetch,
  onDone,
  onCancel,
}: JobFeedbackFlowProps) {
  const [reasonHint, setReasonHint] = useState<string>("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<FeedbackReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runReview() {
    const text = reason.trim() || reasonHint;
    if (!text) {
      setError("Tell us what’s wrong with this listing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = (await apiFetch("/api/jobs/feedback/review", {
        method: "POST",
        body: JSON.stringify({
          jobId: job.id,
          reason: text,
          reasonHint: reasonHint || undefined,
        }),
      })) as { review: FeedbackReviewResult };
      setReview(res.review);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(mode: "learn" | "hide_only") {
    if (!review) return;
    const text = reason.trim() || reasonHint;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/jobs/feedback/confirm", {
        method: "POST",
        body: JSON.stringify({
          jobId: job.id,
          reason: text,
          reasonHint: reasonHint || undefined,
          mode,
          review,
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save feedback");
    } finally {
      setBusy(false);
    }
  }

  const stanceTone =
    review?.aiStance === "agree"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : review?.aiStance === "soft_pushback"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-orange-200 bg-orange-50 text-orange-950";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-zinc-900">
          Teach Career OS
        </h3>
        <p className="mt-1 text-sm text-zinc-600">
          {job.title} @ {job.company}
        </p>

        {!review ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-zinc-700">
              What’s off about this role? The AI will check your take against
              your profile — and may push back if it disagrees.
            </p>
            <div className="flex flex-wrap gap-2">
              {HINTS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setReasonHint(h);
                    if (!reason.trim()) setReason(h);
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    reasonHint === h
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Too senior — I don’t want Director-level ownership yet"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void runReview()} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
                  </>
                ) : (
                  "Ask AI"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className={`rounded-lg border px-3 py-2 text-sm ${stanceTone}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                {review.aiStance === "agree"
                  ? "AI agrees"
                  : review.aiStance === "soft_pushback"
                    ? "AI soft pushback — are you sure?"
                    : "AI strong pushback — reconsider?"}
              </p>
              <p className="mt-1">{review.aiExplanation}</p>
              <p className="mt-2 text-xs opacity-80">
                If you teach from this: {review.constraintSummary}
              </p>
              {review.proposedExperienceCeiling && (
                <p className="mt-1 text-xs opacity-80">
                  Suggested search ceiling: {review.proposedExperienceCeiling}
                </p>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => setReview(null)}
                disabled={busy}
              >
                Edit reason
              </Button>
              <Button
                variant="secondary"
                onClick={() => void confirm("hide_only")}
                disabled={busy}
              >
                Hide this only
              </Button>
              <Button onClick={() => void confirm("learn")} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Learning…
                  </>
                ) : review.aiStance === "agree" ? (
                  "Hide & teach AI"
                ) : (
                  "Still sure — hide & teach"
                )}
              </Button>
            </div>
            <button
              type="button"
              className="text-xs text-zinc-500 underline"
              onClick={onCancel}
              disabled={busy}
            >
              Keep this job (I reconsidered)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
