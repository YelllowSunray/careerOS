"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { CareerIntent, SearchStrategy } from "@/lib/types";

type Msg = { role: "user" | "assistant"; content: string };

export default function IntakePage() {
  const { apiFetch } = useApi();
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draftIntent, setDraftIntent] = useState<CareerIntent | null>(null);
  const [draftStrategy, setDraftStrategy] = useState<SearchStrategy | null>(null);
  const [complete, setComplete] = useState(false);
  const started = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, complete]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sendTurn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendTurn(nextMessages: Msg[]) {
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch<{
        assistantMessage: string;
        isComplete: boolean;
        careerIntent?: CareerIntent;
        searchStrategy?: SearchStrategy;
      }>("/api/intake/chat", {
        method: "POST",
        body: JSON.stringify({ action: "chat", messages: nextMessages }),
      });
      const assistant: Msg = {
        role: "assistant",
        content: result.assistantMessage,
      };
      setMessages([...nextMessages, assistant]);
      if (result.careerIntent) setDraftIntent(result.careerIntent);
      if (result.searchStrategy) setDraftStrategy(result.searchStrategy);
      if (result.isComplete && result.careerIntent && result.searchStrategy) {
        setComplete(true);
        setDraftIntent(result.careerIntent);
        setDraftStrategy(result.searchStrategy);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intake failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    await sendTurn(next);
  }

  async function handleConfirm() {
    if (!draftIntent || !draftStrategy) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/intake/chat", {
        method: "POST",
        body: JSON.stringify({
          action: "confirm",
          careerIntent: draftIntent,
          searchStrategy: draftStrategy,
        }),
      });
      router.replace("/jobs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
      setLoading(false);
    }
  }

  async function handleSkip() {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/intake/chat", {
        method: "POST",
        body: JSON.stringify({ action: "skip" }),
      });
      router.replace("/jobs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skip failed");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardTitle>Career conversation</CardTitle>
        <p className="mt-2 text-sm text-zinc-600">
          Tell us what you want to become — not only what your CV says. We&apos;ll
          build a Dream / Bridge / Never search strategy together.
        </p>

        <div className="mt-6 max-h-[50vh] space-y-3 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50/50 p-3">
          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={`rounded-lg px-3 py-2 text-sm ${
                m.role === "assistant"
                  ? "bg-white text-zinc-800"
                  : "bg-zinc-900 text-white ml-8"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <p className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {!complete ? (
          <form onSubmit={handleSend} className="mt-4 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your answer…"
              disabled={loading}
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        ) : (
          <div className="mt-6 space-y-4 rounded-lg border border-zinc-200 p-4">
            <h3 className="text-sm font-semibold text-zinc-900">Strategy card</h3>
            {draftIntent && (
              <div className="text-sm text-zinc-700">
                <p>
                  <span className="font-medium">North star:</span>{" "}
                  {draftIntent.northStar}
                </p>
                <p className="mt-1 text-zinc-600">{draftIntent.narrative}</p>
                <p className="mt-2">
                  <span className="font-medium">Setting:</span>{" "}
                  {draftIntent.workSetting} · stretch{" "}
                  {draftIntent.stretchTolerance}
                </p>
              </div>
            )}
            {draftStrategy && (
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <div>
                  <p className="font-medium text-emerald-800">Dream</p>
                  <ul className="mt-1 list-inside list-disc text-zinc-600">
                    {draftStrategy.dream.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-sky-800">Bridge</p>
                  <ul className="mt-1 list-inside list-disc text-zinc-600">
                    {draftStrategy.bridge.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-rose-800">Never</p>
                  <ul className="mt-1 list-inside list-disc text-zinc-600">
                    {draftStrategy.never.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleConfirm()} disabled={loading}>
                Confirm strategy &amp; find jobs
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setComplete(false);
                  setDraftStrategy(null);
                }}
                disabled={loading}
              >
                Keep talking
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleSkip()}
            className="text-xs text-zinc-500 underline hover:text-zinc-800"
            disabled={loading}
          >
            Skip for now
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </Card>
    </div>
  );
}
