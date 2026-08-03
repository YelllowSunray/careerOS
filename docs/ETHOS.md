# Career OS Ethos

> Guide every candidate toward their **north star** — not merely toward whatever their CV can get them tomorrow, and not merely toward the dream title they typed.

This document is the product compass for search, matching, coaching, and UX. When features conflict, prefer this ethos over short-term funnel hacks.

---

## One-sentence principle

**North star sets direction; the CV sets the next foothold; Never sets the cliffs; the feed shows footholds and marked stretches toward the peak — never only the peak or only the cliff edge.**

---

## What Career OS is

Career OS is an **AI career partner**. It:

1. **Learns who they are becoming** (career conversation, Intent, prefs, taught lessons)
2. **Respects who they are on paper** (CV, LinkedIn, skills, languages)
3. **Honors what they refuse** (Never, anti-goals, commute, hard language gates)
4. **Searches and scores jobs as steps on a path** toward the north star
5. **Coaches when the path is empty** — proposes better footholds, not silence

It is not a keyword job board wrapper. It is not a “only hireable-now” filter that erases ambition. It is not an ambition engine that ignores craft reality.

---

## Three layers (keep them separate)

| Layer | Source of truth | Role |
|--------|-----------------|------|
| **Identity** | CV, LinkedIn, inferred roles, ladder evidence | What employers can believe *today* |
| **North star** | Career Intent, narrative, horizons, enabled dream targets | What they are climbing *toward* |
| **Boundaries** | Never list, anti-goals, commute, languages, taught constraints | What must never appear |

**Do not collapse layers.**

- Do not paste the north star sentence into LinkedIn as the only query.
- Do not let inferred floor/ops titles override a clear Never / office Intent.
- Do not treat Boundaries as soft color; they are cliffs.

---

## The path model

Every saved job should be interpretable as **distance to the north star**:

| Path type | Meaning | Default UX |
|-----------|---------|------------|
| **destination** | Clearly on-path; strong alignment with near-term or stated destination | Show prominently |
| **step** | Same craft family, more scope or adjacency; builds toward the star | Show by default |
| **stretch** | Toward the star, but craft/seniority/proof gap | Show when stretch tolerance allows; always with gaps |
| **lateral** | Little progress toward the star | Hide by default |
| **regressive** | Away from the star or into Never | Hard hide |

Seniority is **relative to this person and their star**, not a global ban on the word “senior.”

- A “Senior Project Officer” can be a **step** for a mid Project Officer aiming at Head of Impact.
- The same title can be **stretch** or **regressive** if they cannot defend senior must-haves — or if they explicitly refuse that rung *for now*.

“No senior” in prefs means: *don’t surface roles where senior is a hard day-one requirement they can’t meet* — not *never climb the next rung*.

---

## Search ethos

Search exists to **explore the path**, not to recite the dream.

1. **Synthesize board-ready queries** (short, realistic titles boards understand) from Intent + Strategy + CV + ladder + prefs.
2. Prefer a mix: **hireable footholds (bridge/step)** plus at most a careful **dream/stretch** slice — governed by stretch tolerance.
3. Map aspirations like “found my own NGO” or “become Head of X” into **searchable footholds** (program coordinator, project officer NGO, social impact manager) while keeping the star in Intent for scoring and coaching.
4. Never-list and anti-goals suppress whole role families from discovery and save.
5. Location must be **board-usable** (real country/city). Continents and multi-region poems belong in prefs/Intent narrative, not the LinkedIn `location` field.

Empty funnel is a **coaching moment**, not a failure to hide: diagnose, propose path adjustments, confirm with the human.

---

## Match ethos

Matching answers two questions, in order:

1. **Craft / eligibility** — Could a realistic employer interview them for *this* job with *this* evidence?  
2. **Path** — Does accepting this job move them toward the north star, sideways, or backward?

Rules of thumb:

- Hard gates (language, commute/home-base, Never, taught hard constraints) still **hide**.
- Craft `not_eligible` on a **dream/target** title may become **visible stretch** when stretch tolerance allows — with honest gaps, never fake day-one readiness.
- Craft `not_eligible` on **Never / regressive** roles stays hidden.
- Fit scores and apply recommendations should not congratulate laterals as career wins.
- Reasoning and UI must name the path: *step toward Head of Social Impact*, *stretch Logistiek Planner*, *off-path — hidden*.

---

## Stretch tolerance (ambition dial)

| Mode | Search / feed behavior |
|------|-------------------------|
| **hireable_only** | Mostly steps + near destinations; stretch rare or hidden |
| **show_stretch** | Default for ambitious Intent: footholds + marked stretch toward star |
| **dream_aggressive** | Keep a dream query; show stretch matches more freely, still with gaps |

The dial is user-owned. The product advises; it does not silently flip ambition off to get a prettier empty state, nor silently invent eligibility to fill the feed.

---

## Coaching ethos

The agent is **on their team**:

- Speak in path language tied to the north star.
- When empty: explain *why* (geo, craft, senior conflict, unsearchable dream query) and offer **confirmed** strategy changes.
- When they dislike a job: update the path (anti-goals, Never, open questions) — don’t only append opaque constraints.
- Be honest about tradeoffs: “Planner is the star; interviews will be hard without planning proof. These bridge roles get you into the office *and* build the story.”

Never “help” by sending them back onto a cliff they named (warehouse floor, PA track, etc.).

---

## Product tests (use these in reviews)

1. **Star test** — If we remove the nav, does the Jobs experience still feel aimed at *their* north star?
2. **Foothold test** — Would a realistic employer interview them for the majority of *shown* (non-stretch) roles?
3. **Cliff test** — Can Never / anti-goals still produce those jobs in the feed? (Must be no.)
4. **Honesty test** — Do stretch cards admit gaps, or do they pretend day-one fit?
5. **Empty test** — Does emptiness produce coaching + a confirmable replan, or silence?
6. **Janus/Mala test** — Warehouse→office planner and NGO officer→impact lead both get footholds *and* a visible star, without betraying Boundaries.

---

## Anti-patterns (do not ship)

- Using north-star prose or “founder of my own…” as LinkedIn keywords.
- Letting strategy lanes wipe hireable ladder titles without replacing them with real bridge queries.
- Hard-hiding all stretch while only searching Head-of / founder titles.
- Searching “Senior X” while non-negotiables say “no senior must-haves,” with no reconciliation.
- Multi-continent strings as a single job-board location.
- Collapsing Intent, CV, and Never into one free-text blob the model reinterprets differently every round.

---

## How teams should use this doc

- **Product / design:** Path board UX, coach copy, Intent editors.
- **Agents / prompts:** Query synthesis, match pathType, empty-funnel coach.
- **Engineering:** Keep Identity / North star / Boundaries as separate stored fields; never overload one string.
- **QA:** Run the six product tests on every major search/match change.

When in doubt: **guide toward the star with honest footholds.**

---

*Last aligned with Career Intent + Adaptive Hunt and the north-star path discussion (2026).*
