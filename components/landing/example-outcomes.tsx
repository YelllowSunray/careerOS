"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { PATH_TYPE_LABELS } from "@/lib/career/ethos";
import { Reveal } from "@/components/landing/reveal";

const EXAMPLE_LADDER = {
  currentRole: "Magazijnchef",
  summary:
    "Climb from shift-floor leadership into planning and supervisory scope — search Dutch titles first, then adjacent office steps.",
  nextRoles: [
    {
      title: "Logistiek supervisor",
      branch: "same" as const,
      whyScopeIncreases:
        "Owns the full shift, not only own tasks — team, safety, and throughput.",
      transferableStrengths: [
        "Shift coordination",
        "VCA / safety",
        "Dutch-language floor leadership",
      ],
      gapsToClose: ["KPI reporting", "Workforce planning across shifts"],
    },
    {
      title: "Teamleider warehouse",
      branch: "same" as const,
      whyScopeIncreases: "People leadership and stakeholder contact with operations.",
      transferableStrengths: ["Coaching pickers", "Daily stand-ups"],
      gapsToClose: ["Formal HR conversations"],
    },
  ],
  stretchRoles: [
    {
      title: "Logistiek planner",
      branch: "adjacent" as const,
      whyScopeIncreases:
        "Moves from floor execution into office planning — still the same craft family.",
      transferableStrengths: ["Knows warehouse constraints from the floor"],
      gapsToClose: ["WMS planning tools", "Transport coordination"],
    },
  ],
};

const EXAMPLE_MATCH = {
  title: "Logistiek Supervisor",
  company: "Voorbeeld Logistiek B.V.",
  location: "Utrecht",
  listingLanguage: "nl" as const,
  fitScore: 88,
  pathType: "step" as const,
  scopeIncrease: 72,
  matchedDestination: "Logistiek supervisor",
  ladderPath:
    "Step toward logistiek supervisor via shift ownership and team lead evidence already on the CV.",
  contributionScore: 84,
  learningScore: 71,
  moneyScore: 68,
  scopeScore: 72,
  reasoning:
    "Core craft is warehouse leadership, not a title clone. Dutch listing language matches how this role is posted. Scope steps up from chef to supervisor; remaining gaps are reporting, not the job itself.",
  strengths: [
    "Shift leadership in Dutch",
    "Safety / VCA",
    "Team coordination",
  ],
};

export function ExampleOutcomes() {
  const path = PATH_TYPE_LABELS[EXAMPLE_MATCH.pathType];

  return (
    <section className="relative bg-[#e8f2ef] px-5 py-20 sm:px-8 sm:py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(180deg, transparent, rgba(247,251,250,0.9)), repeating-linear-gradient(-12deg, transparent, transparent 18px, rgba(7,17,15,0.03) 18px, rgba(7,17,15,0.03) 19px)",
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0c6b57]">
            Example — not a real user
          </p>
          <h2 className="landing-display mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            What a ladder and a scored match look like
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
            Same structure you get after a CV is processed: current role, next
            steps, stretch, then listings scored for contribution, learning,
            pay, and scope. This sample is labeled as an example.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <Reveal delayMs={60}>
            <Card className="h-full border-[#07110f]/8 bg-white/90 shadow-none">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="landing-display text-[#07110f]">
                  Career ladder
                </CardTitle>
                <span className="rounded-md bg-[#07110f]/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#0c6b57]">
                  Example
                </span>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Current
                  </p>
                  <p className="mt-0.5 text-sm font-medium">
                    {EXAMPLE_LADDER.currentRole}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    {EXAMPLE_LADDER.summary}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Next roles (steps)
                  </p>
                  <ul className="mt-2 space-y-3">
                    {EXAMPLE_LADDER.nextRoles.map((r) => (
                      <li
                        key={r.title}
                        className="rounded-lg border border-zinc-100 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{r.title}</span>
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase text-sky-800">
                            {r.branch}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-600">
                          <span className="font-medium text-zinc-800">
                            Scope:{" "}
                          </span>
                          {r.whyScopeIncreases}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Transfer: {r.transferableStrengths.join("; ")}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Gaps: {r.gapsToClose.join("; ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Stretch (~1–2 years)
                  </p>
                  <ul className="mt-2 space-y-3">
                    {EXAMPLE_LADDER.stretchRoles.map((r) => (
                      <li
                        key={r.title}
                        className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{r.title}</span>
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase text-violet-800">
                            {r.branch}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-600">
                          <span className="font-medium text-zinc-800">
                            Scope:{" "}
                          </span>
                          {r.whyScopeIncreases}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Transfer: {r.transferableStrengths.join("; ")}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Gaps: {r.gapsToClose.join("; ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </Reveal>

          <Reveal delayMs={140}>
            <Card className="h-full border-[#07110f]/8 bg-white/90 shadow-none">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="break-words">
                      {EXAMPLE_MATCH.title}
                    </CardTitle>
                    <span className="rounded-md bg-[#07110f]/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#0c6b57]">
                      Example
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-zinc-500">
                      {EXAMPLE_MATCH.company} · {EXAMPLE_MATCH.location}
                    </p>
                    <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-800">
                      Dutch listing
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xl font-bold text-zinc-900 sm:text-2xl">
                    {EXAMPLE_MATCH.fitScore}
                  </div>
                  <div className="text-xs text-zinc-500">fit score</div>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="rounded-lg bg-zinc-900 px-3 py-2 text-zinc-50">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200"
                      title={path?.hint}
                    >
                      {path?.label ?? EXAMPLE_MATCH.pathType}
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                      Scope +{EXAMPLE_MATCH.scopeIncrease}
                    </span>
                    <span className="text-xs text-zinc-400">
                      → {EXAMPLE_MATCH.matchedDestination}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-snug text-zinc-100">
                    {EXAMPLE_MATCH.ladderPath}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
                  {[
                    {
                      label: "Contribute",
                      score: EXAMPLE_MATCH.contributionScore,
                      tone: "bg-emerald-50 text-emerald-950",
                    },
                    {
                      label: "Learn",
                      score: EXAMPLE_MATCH.learningScore,
                      tone: "bg-violet-50 text-violet-950",
                    },
                    {
                      label: "Money",
                      score: EXAMPLE_MATCH.moneyScore,
                      tone: "bg-amber-50 text-amber-950",
                    },
                    {
                      label: "Scope",
                      score: EXAMPLE_MATCH.scopeScore,
                      tone: "bg-sky-50 text-sky-950",
                    },
                  ].map((pillar) => (
                    <div
                      key={pillar.label}
                      className={`rounded-lg px-2 py-2 sm:px-2.5 ${pillar.tone}`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wide opacity-80 sm:text-[11px]">
                        {pillar.label}
                      </p>
                      <p className="text-base font-semibold tabular-nums sm:text-lg">
                        {pillar.score}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="text-zinc-600">{EXAMPLE_MATCH.reasoning}</p>
                <p>
                  <span className="font-medium text-emerald-700">
                    Strengths:{" "}
                  </span>
                  {EXAMPLE_MATCH.strengths.join("; ")}
                </p>
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
