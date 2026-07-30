"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DM_Sans, Syne } from "next/font/google";

const display = Syne({
  subsets: ["latin"],
  variable: "--font-landing-display",
  weight: ["600", "700", "800"],
});

const body = DM_Sans({
  subsets: ["latin"],
  variable: "--font-landing-body",
  weight: ["400", "500", "600", "700"],
});

const STEPS = [
  {
    n: "01",
    title: "Build your career ladder",
    body: "Upload your CV and optional LinkedIn. Career OS maps where you are now, the next roles that raise your scope, and stretch goals a year out — in Dutch or English.",
  },
  {
    n: "02",
    title: "Search where the jobs actually live",
    body: "We hunt LinkedIn, Indeed, and other boards with keywords tuned to your market — Dutch titles for logistics and care, English for international tech — then keep searching until you pause.",
  },
  {
    n: "03",
    title: "Match on fit, not title clones",
    body: "Every listing is scored for contribution, learning, pay, and scope step-up. Language, skills, and commute gates keep noise out of your feed.",
  },
  {
    n: "04",
    title: "Apply with letters that fit the brief",
    body: "Generate cover letters in English or Dutch from the live job posting — grounded in your CV and written in your voice.",
  },
] as const;

const REVIEWS = [
  {
    quote:
      "Ik zocht magazijn- en logistiekrollen in het Nederlands. Career OS vond vacatures die LinkedIn-zoeken in het Engels gewoon oversloeg — en de match-scores klopten.",
    name: "Mike B.",
    role: "Magazijnchef → Logistiek supervisor",
    locale: "NL",
  },
  {
    quote:
      "Finally something that searches for my next role, not a clone of my current title. The ladder view made the stretch jobs feel intentional instead of random.",
    name: "Aisha K.",
    role: "Compliance analyst → Risk & AML",
    locale: "EN",
  },
  {
    quote:
      "Dutch cover letters that actually address the vacaturetekst. I stopped pasting the same generic brief into every application.",
    name: "Sanne V.",
    role: "Teamlead operations",
    locale: "EN",
  },
  {
    quote:
      "De commute-filter was goud waard. Geen nachtdiensten, max reistijd, en Engels + Nederlands in één zoekopdracht. Voelt als een agent die me kent.",
    name: "Jonas M.",
    role: "Zorg & logistiek switcher",
    locale: "NL",
  },
] as const;

function useInView<T extends HTMLElement>(margin = "0px 0px -10% 0px") {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: margin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [margin]);

  return { ref, visible };
}

function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const { ref, visible } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 700ms ease ${delayMs}ms, transform 700ms ease ${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}

export function LandingPage() {
  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen overflow-x-hidden bg-[#f7fbfa] text-[#07110f]`}
      style={
        {
          fontFamily: "var(--font-landing-body), ui-sans-serif, sans-serif",
          ["--landing-ink" as string]: "#07110f",
          ["--landing-mist" as string]: "#e8f2ef",
          ["--landing-foam" as string]: "#f7fbfa",
          ["--landing-jade" as string]: "#149c7f",
          ["--landing-jade-deep" as string]: "#0c6b57",
        } as React.CSSProperties
      }
    >
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <span
            className="text-lg font-bold tracking-tight text-white sm:text-xl"
            style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
          >
            Career OS
          </span>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#07110f] transition hover:bg-[#e8f2ef] sm:px-4"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — one composition: brand, headline, support, CTAs, full-bleed media */}
      <section className="relative isolate min-h-[100svh] overflow-hidden bg-[#07110f] text-white">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=2400&q=80"
            alt=""
            className="landing-hero-media h-full w-full object-cover opacity-55"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, rgba(7,17,15,0.92) 0%, rgba(7,17,15,0.72) 42%, rgba(7,17,15,0.35) 70%, rgba(20,156,127,0.25) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, rgba(20,156,127,0.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(232,242,239,0.12), transparent 40%)",
            }}
          />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-32">
          <div className="landing-hero-copy max-w-3xl">
            <p
              className="mb-4 text-4xl font-extrabold tracking-tight text-white sm:text-6xl md:text-7xl"
              style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
            >
              Career OS
            </p>
            <h1
              className="text-3xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-[3.4rem]"
              style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
            >
              Find your dream job in Dutch and English
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
              An AI career agent that builds your ladder, searches local and
              international listings, and helps you apply with letters that fit
              each brief.
            </p>
          </div>
          <div className="landing-hero-cta mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-lg bg-[#149c7f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c6b57]"
            >
              Start free
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/5 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/12"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Bilingual market */}
      <section className="relative overflow-hidden bg-[#f7fbfa] px-5 py-20 sm:px-8 sm:py-28">
        <div
          className="pointer-events-none absolute -right-24 top-10 h-72 w-72 rounded-full opacity-50"
          style={{
            background:
              "radial-gradient(circle, rgba(20,156,127,0.22), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0c6b57]">
              Nederlands · English
            </p>
            <h2
              className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
            >
              One market, two languages — searches that match how jobs are
              posted
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
              Tech roles in the Netherlands often list in English. Warehouse,
              care, and operations roles usually list in Dutch. Career OS picks
              the right keyword language for your profile — or you choose.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-10 sm:grid-cols-2">
            <Reveal delayMs={80}>
              <p
                className="text-5xl font-extrabold text-[#149c7f]"
                style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
              >
                NL
              </p>
              <p className="mt-3 text-lg font-semibold">Dutch listings</p>
              <p className="mt-2 leading-relaxed text-zinc-600">
                Queries like <em>magazijnchef</em>, <em>logistiek supervisor</em>,
                and <em>teamleider zorg</em> — the phrases boards actually index.
              </p>
            </Reveal>
            <Reveal delayMs={160}>
              <p
                className="text-5xl font-extrabold text-[#07110f]"
                style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
              >
                EN
              </p>
              <p className="mt-3 text-lg font-semibold">English listings</p>
              <p className="mt-2 leading-relaxed text-zinc-600">
                International and tech titles stay in English, with matching
                cover letters when you are ready to apply.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-[#07110f] px-5 py-20 text-white sm:px-8 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#149c7f]">
              How it works
            </p>
            <h2
              className="mt-3 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
            >
              From knowledge graph to applications
            </h2>
          </Reveal>
          <ol className="mt-14 space-y-12 sm:space-y-16">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delayMs={i * 60}>
                <li className="grid gap-4 border-t border-white/10 pt-8 sm:grid-cols-[5rem_1fr] sm:gap-10">
                  <span
                    className="text-2xl font-bold text-[#149c7f]"
                    style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
                  >
                    {step.n}
                  </span>
                  <div>
                    <h3
                      className="text-xl font-bold sm:text-2xl"
                      style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
                    >
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-2xl text-base leading-relaxed text-white/65">
                      {step.body}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Reviews — typography, not cards */}
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
              What people say
            </p>
            <h2
              className="mt-3 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
            >
              Built for real job hunts — not another keyword dump
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-12 md:grid-cols-2">
            {REVIEWS.map((r, i) => (
              <Reveal key={r.name} delayMs={i * 70}>
                <blockquote>
                  <p
                    className="text-xl font-semibold leading-snug tracking-tight text-[#07110f] sm:text-2xl"
                    style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
                  >
                    “{r.quote}”
                  </p>
                  <footer className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-zinc-500">{r.role}</span>
                    <span className="rounded-md bg-[#07110f]/5 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-[#0c6b57]">
                      {r.locale}
                    </span>
                  </footer>
                </blockquote>
              </Reveal>
            ))}
          </div>
          <p className="mt-10 text-xs text-zinc-500">
            Illustrative testimonials for product storytelling — not verified
            customer quotes.
          </p>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative overflow-hidden bg-[#f7fbfa] px-5 py-20 sm:px-8 sm:py-28">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(20,156,127,0.18), transparent 60%)",
          }}
        />
        <Reveal className="relative mx-auto max-w-3xl text-center">
          <h2
            className="text-3xl font-bold tracking-tight sm:text-5xl"
            style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
          >
            Ready to climb your ladder?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-600 sm:text-lg">
            Create an account, upload your CV, and let Career OS find roles that
            raise your scope — in Dutch, English, or both.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-lg bg-[#149c7f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0c6b57]"
            >
              Create your account
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-[#07110f]/15 px-6 py-3 text-sm font-semibold text-[#07110f] transition hover:bg-[#e8f2ef]"
            >
              I already have an account
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-[#07110f]/8 bg-[#f7fbfa] px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="text-sm font-bold"
            style={{ fontFamily: "var(--font-landing-display), ui-sans-serif, sans-serif" }}
          >
            Career OS
          </p>
          <p className="text-sm text-zinc-500">
            AI career agent · Dream jobs in Dutch & English
          </p>
        </div>
      </footer>
    </div>
  );
}
