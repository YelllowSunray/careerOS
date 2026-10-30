"use client";

import { Reveal } from "@/components/landing/reveal";

/** Styled mock of the product flow — example UI, not a live user. */
export function ProductPreview() {
  return (
    <section className="relative overflow-hidden bg-[#07110f] px-5 py-20 text-white sm:px-8 sm:py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 12% 20%, rgba(20,156,127,0.28), transparent 42%), radial-gradient(circle at 88% 80%, rgba(232,242,239,0.08), transparent 38%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#149c7f]">
            Product preview
          </p>
          <h2 className="landing-display mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            CV in. Ladder and scored jobs out.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
            A styled look at the flow — not a live search, and not a real
            candidate. Upload a CV. Career OS maps the next rung, then scores
            listings against that path.
          </p>
        </Reveal>

        <Reveal delayMs={80} className="mt-12">
          <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0c1c19] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="ml-3 text-xs font-medium tracking-wide text-white/45">
                Career OS · example
              </span>
            </div>

            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.2fr)]">
              <div className="border-b border-white/8 p-5 sm:p-6 lg:border-b-0 lg:border-r">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#149c7f]">
                  1 · CV in
                </p>
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-9 items-end justify-center rounded-sm bg-[#e8f2ef] pb-1">
                      <span className="text-[9px] font-bold tracking-wide text-[#0c6b57]">
                        PDF
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">cv.pdf</p>
                      <p className="text-xs text-white/50">
                        Uploaded · text extracted
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2" aria-hidden="true">
                    <div className="h-1.5 w-full rounded-full bg-white/12" />
                    <div className="h-1.5 w-5/6 rounded-full bg-white/10" />
                    <div className="h-1.5 w-4/6 rounded-full bg-white/8" />
                    <div className="h-1.5 w-3/4 rounded-full bg-white/8" />
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-white/55">
                    Current title read from the CV:{" "}
                    <span className="font-medium text-white/85">
                      Magazijnchef
                    </span>
                    . Search language follows how Dutch boards index the role.
                  </p>
                </div>
              </div>

              <div className="hidden items-center justify-center px-2 text-[#149c7f] lg:flex">
                <span className="landing-display text-2xl" aria-hidden="true">
                  →
                </span>
              </div>

              <div className="grid gap-4 p-5 sm:p-6 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#149c7f]">
                    2 · Career ladder
                  </p>
                  <ol className="mt-4 space-y-2">
                    <li className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-white/40">
                        Current
                      </p>
                      <p className="mt-0.5 text-sm font-semibold">
                        Magazijnchef
                      </p>
                    </li>
                    <li className="rounded-lg border border-[#149c7f]/35 bg-[#149c7f]/10 px-3 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[#149c7f]">
                        Next · same
                      </p>
                      <p className="mt-0.5 text-sm font-semibold">
                        Logistiek supervisor
                      </p>
                    </li>
                    <li className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-white/40">
                        Stretch · adjacent
                      </p>
                      <p className="mt-0.5 text-sm font-semibold">
                        Logistiek planner
                      </p>
                    </li>
                  </ol>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#149c7f]">
                    3 · Scored match
                  </p>
                  <div className="mt-4 rounded-lg border border-white/10 bg-white p-3.5 text-[#07110f]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold leading-snug">
                          Logistiek Supervisor
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Voorbeeld Logistiek · Utrecht
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold tabular-nums">88</p>
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                          fit
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-800">
                        Dutch listing
                      </span>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">
                        Step forward
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                      Query used{" "}
                      <em>logistiek supervisor</em> — the Dutch phrase boards
                      actually index, not an English clone of the current title.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/40">
            Example interface for product storytelling. Scores and roles are
            illustrative.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
