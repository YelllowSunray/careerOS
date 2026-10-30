"use client";

import { Reveal } from "@/components/landing/reveal";

const FAQ = [
  {
    q: "How much does it cost?",
    a: "Free to start. Create an account, upload a CV, and run a search. There is no paid plan in the product today.",
  },
  {
    q: "What does “keeps searching until you pause” mean?",
    a: "Find Jobs starts a continuous loop: it discovers listings, scores them, saves matches that pass your gates, waits a short interval, then searches again. It keeps going until you click Pause (or the run stops because it failed). Saved matches stay. Listings you already rejected stay skipped when you start Find Jobs again, until you Clear Results.",
  },
  {
    q: "How is my CV handled?",
    a: "You need a signed-in account to upload. The file is stored on that account. Career OS extracts the text, saves it with your profile, and uses it — including sending it to the AI model (Gemini) — to build your career ladder, search and score jobs, and write cover letters. Your resume is not listed on a public page; reads are limited to your account and the server-side tools that process it. From Profile you can delete the uploaded CV, which removes the file, the extracted resume, and the generated candidate profile.",
  },
] as const;

export function LandingFaq() {
  return (
    <section
      id="faq"
      className="bg-[#f7fbfa] px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0c6b57]">
            FAQ
          </p>
          <h2 className="landing-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Straight answers
          </h2>
        </Reveal>
        <div className="landing-faq mt-10 divide-y divide-[#07110f]/10 border-y border-[#07110f]/10">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delayMs={i * 50}>
              <details className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left">
                  <span className="landing-display text-lg font-bold tracking-tight sm:text-xl">
                    {item.q}
                  </span>
                  <span
                    className="mt-1 shrink-0 text-lg leading-none text-[#149c7f] transition group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-600">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
