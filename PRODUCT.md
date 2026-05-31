<!-- SNAPSHOT MIRROR — canonical lives in the planning repo (PRODUCT.md). Carried here so a
     mobile/cloud session opening only this repo has the product map without checking out the
     planning repo. Can drift; refresh with ./sync-mirrors.sh from the planning repo
     (last sync = this file's git history). -->

# auditjob.me — The Public Product (Foundation)

> **What this document is.** The introduction chapter for turning the personal
> `career-ops` engine into a public web product on **auditjob.me**. It is the
> skeleton, not the detailed design: it states what we're building, sketches how
> the pieces fit, and breaks the work into **parts** — each of which gets its own
> focused session later (most of them drivable from the phone). When you want to
> work on "the onboarding" or "the backend," you open the matching part below,
> spin up a session, and go deep there. This file is the map that keeps all those
> sessions pointing the same direction.
>
> It is **not** a replacement for `ROADMAP.md` (which tracks engine features) — it
> cross-links it. See §5.

---

## 0. What we're building (thesis & scope)

**Thesis.** `career-ops` already does something most job-seekers never get: it
scrapes roles from dozens of sources every day, scores each one against a deep
personal profile, and hands back a ranked, personalized shortlist. Today that
power serves exactly one person. **auditjob.me is that same engine, opened up for
other people** — a suite of career-ops superpowers for **Product Managers (PMs)**.

The company audit (the thing auditjob.me's landing page sells today —
*"show them you already did the job"*) is **one feature inside the suite**, not the
headline. The sourcing + scoring + personalized daily digest is the core, because
that's the part that's genuinely hard to build and "way more powerful" than the
audit alone.

**The economic spine: free to use, bring-your-own-compute (BYO-compute).** The app
is free. The expensive part — the Large Language Model (LLM) calls that score
roles and write audits — runs on **each user's own AI provider account**, not on
ours. The user connects their provider during onboarding; their compute is billed
to them. This is what makes "free" survivable, and it removes any incentive to
cheapen quality (see the audit part in §3).

**Scope at launch (deliberately narrow):**
- **Role type:** Product Manager roles only. It's the archetype the engine is
  already tuned for, so quality is real on day one.
- **Geography:** Europe-first — same reason, same fit.
- **Not** "every role in the world." Widening comes after the PM/Europe wedge works.

**Explicitly out of scope for now:** the landing page copy and the product name
(both already exist, both fine), visual design polish, and any role type beyond PM.

---

## 1. What we're fusing (the two halves)

We are joining a **capability** (the engine) to a **shell** (the web product).

### The engine — `career-ops` (the capability)
A Node command-line system, file-based, single-user today. What it does:
- **Sourcing:** `scan.mjs` pulls roles from **13 Applicant Tracking System (ATS)
  scrapers** (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday, plus
  big-tech and per-company APIs), several venture-capital portfolio boards,
  startupmap, and Y Combinator. A separate LinkedIn scraper runs in an
  authenticated browser.
- **Scoring:** `jd-score.mjs` (the v6.1 two-lane rubric — 5 orthogonal signals via
  Claude) plus `triage.mjs` (heuristic penalties and boosts).
- **Output:** `morning-tables.mjs` renders ranked tables into `digests/`.
- **The key fact for going multi-user:** the engine logic is *generic*. What makes
  it personal is the **profile context injected into the scoring prompt**. That
  per-user surface is a small, bounded set of files — `config/profile.yml`,
  `modes/_profile.md`, `portals.yml`, `cv.md`, `data/linkedin_connections.tsv`,
  `data/applications.md`. **Multi-tenancy = move those into a database, one row-set
  per user, and parameterize the prompt.** The hard engine doesn't change much.

### The shell — auditjob.me (the product)
A Vite + React single-page app (TypeScript), styled with Tailwind + shadcn/ui,
built in Lovable, backed by Supabase (Postgres + Google sign-in). What's already
built and working:
- Landing page, brand/color system (sage `#8a9a8a` on dark charcoal), **Google
  sign-in**, public audit display at `/a/:username/:slug`, legal pages.
- Database schema already present: `audits`, `profiles`, `purchases` (Stripe),
  `whitelisted_emails`, `device_fingerprints`, `feedback`.
- **Not** built yet: any sourcing/scoring, the audit-generation engine itself,
  dashboards, profile ingestion. Today it is a **display + auth + marketing shell**
  waiting for an engine behind it.

### The three repositories
| # | Path | GitHub remote | Role |
|---|------|---------------|------|
| 1 | `…/Coding/Auditjobme&careerops/` | `lifeinprogrezz/auditjobme-careerops-planning` | Planning / coordination + the phone/GitHub surface. **This file lives here.** `career-ops/` is nested inside. |
| 2 | `…/Auditjobme&careerops/career-ops/` | `lifeinprogrezz/career-ops-rober` | The engine (Node CLI, pinned fork). |
| 3 | `…/Coding/auditjobme/` *(sibling)* | `lifeinprogrezz/auditjobme` | The public web product (Vite + Supabase). |

### The strategic reframe (worth saying out loud)
Earlier planning had this backwards: it treated "integration" as `career-ops`
*calling* auditjob.me to mint a single audit URL during an evaluation. **The real
direction is the inverse and much bigger: auditjob.me becomes the public face of
career-ops.** This also supersedes the older framing of auditjob.me as
"positioning, not a venture" — it's now being shipped as a real multi-user product
(the Stripe schema is already there).

---

## 2. Architecture (how the halves connect)

The whole thing rests on **one core principle** plus **three cross-cutting ones**.

**Core principle — shared sourcing, per-user scoring.**
Scraping a company's ATS is the same work no matter who's asking, and it costs
nothing in LLM tokens. Scoring is where the personalization (and the cost) lives.
So:
- **Scrape each company once** into a **shared roles pool** (server-side,
  scheduled). One scan serves every user. This kills most of the cost and the
  rate-limit / IP-blocking risk.
- **Score that shared pool per user**, against their profile, on their compute.
- **LinkedIn is the per-user exception** — each user's feed and network is theirs
  alone, read through the browser extension (below).

**Cross-cutting principle A — bring-your-own-compute.** Every per-user LLM call
runs on the user's connected provider. Our cost scales with users at roughly zero
marginal LLM spend.

**Cross-cutting principle B — async + notify.** Heavy work (scoring a full daily
digest, generating a quality audit) must never make the user stare at a spinner
for a minute. It goes through a **job queue**: enqueue → run in the background →
write results → **email the user** (their Google connection) when it's ready.
Anything interactive uses the **fastest** model the user's provider offers.

**Cross-cutting principle C — mobile-first from day one.** This audience reviews
roles and fires audits on their phone, so every surface is built mobile-first and
fully responsive from the *very first commit* — desktop is the enhancement, not the
default. We never ship a desktop-only screen and "make it responsive later." The
existing SPA already leans this way (Tailwind + a `use-mobile` hook); every new
part holds the line.

```
                          ┌─────────────────────────────────────────┐
                          │  auditjob.me SPA  (Vite + React, exists)  │
                          │  sign-in · onboarding · dashboard/digest  │
                          │  fire-audit · effort selector · account   │
                          └───────────────┬───────────────────────────┘
                                          │ reads / writes
                                          ▼
                          ┌─────────────────────────────────────────┐
                          │             Supabase (exists)            │
                          │  Postgres + Auth + Storage · RLS tenancy  │
                          │  SHARED: companies, roles                 │
                          │  PER-USER: profiles, user_role_scores,    │
                          │   audits, linkedin_data, applications,    │
                          │   provider_credentials (encrypted)        │
                          └───▲───────────────▲──────────────▲────────┘
                              │ results       │ profile      │ live roles
                              │               │ + key        │ + network
        ┌─────────────────────┴───┐   ┌───────┴────────┐   ┌─┴───────────────────┐
        │   Engine-as-service     │   │  Onboarding    │   │ LinkedIn extension  │
        │  (career-ops, hosted)   │   │  (4 inputs)    │   │  (user's own        │
        │  scan · score · render  │   │  Google · LLM  │   │   browser session)  │
        │  + JOB QUEUE            │   │  · LinkedIn    │   └─────────────────────┘
        │  scrapes shared pool;   │   │  · CV          │
        │  scores per user ON     │   └───────┬────────┘
        │  THEIR provider →       │           │ runs LLM calls on
        │  emails when done       │           ▼
        └─────────────────────────┘   ┌────────────────────┐
                                       │  User's AI provider │
                                       │  (BYO key / OAuth)  │
                                       └────────────────────┘
```

**Components**
1. **auditjob.me SPA** *(exists)* — the entire front end: sign-in, onboarding,
   the dashboard where the daily digest lives, the fire-an-audit action, the
   effort selector, account/settings.
2. **Supabase** *(exists)* — system of record. Row-Level Security (RLS) enforces
   tenancy. Shared tables (`companies`, `roles`) + per-user tables (`profiles`,
   `user_role_scores`, `audits`, `linkedin_data`, `applications`, and an
   **encrypted** `provider_credentials`).
3. **Engine-as-service** *(new hosting of existing Node code)* — the `career-ops`
   scripts refactored to run server-side, multi-tenant, on a schedule, writing to
   Supabase instead of local files, fronted by a **job queue**. It needs a real
   Node host (Railway / Render / Fly / Vercel Cron) — **not** Supabase Edge
   Functions alone, which are short-lived Deno and can't run the long pipeline.
   *(Exact host = decided in the backend part.)*
4. **LinkedIn browser extension** *(new)* — installed by the user, reads their
   LinkedIn (recommended jobs, saved jobs, connections) **in their own session,
   client-side**, and posts it to the backend. This is the multi-tenant-safe
   replacement for the current headful-browser scraper, which cannot transfer to
   other users. It feeds both sourcing (their feed) and scoring (warm-path boosts
   from their network).

**Onboarding inputs — 4 musts + 1 nice-to-have**
- **MUST · Google sign-in** *(exists)* — identity + the channel for email
  notifications and reminders.
- **MUST · LLM provider** — the compute that runs scoring and audits. The effort
  selector picks the model tier on *this* provider.
- **MUST · LinkedIn** — connected via the extension; per-user live roles + network.
- **MUST · curriculum vitae (CV)** — uploaded and parsed into the structured
  profile that personalizes scoring (the product-side replacement for the
  hand-authored `cv.md`).
- **NICE-TO-HAVE · LinkedIn data export** — the user uploads their full LinkedIn
  export for a richer historical network/connections snapshot, complementing the
  live extension feed.

**Effort selector.** Users don't know how much "power" to spend, so we abstract it:
**low / medium / high** maps to a model tier on their connected provider
(fast-and-cheap → frontier). It drives both digest scoring depth and audit depth.

**Flagged risks** (each is an open question owned by its part):
- **BYO-provider onboarding friction — highest risk, validate first.** Consumer
  ChatGPT Plus / Claude Pro logins have **no programmable API**. "Connect your
  provider" therefore means a developer API key (pay-as-you-go) or an
  OAuth-billing passthrough where one exists (still immature in early 2026). For a
  non-technical PM, "create a developer account and add a card" is the single
  biggest threat to the free-and-easy promise. De-risk it in parts 1–2, not later.
- Engine multi-tenancy refactor — the biggest build.
- Browser-extension store review + Manifest V3 limits + keeping it ToS-defensible
  (it only ever reads the user's *own* data in the user's *own* session).
- CV parsing — a genuinely new capability (today the CV is hand-authored).
- Secure storage of user provider keys.
- Shared-IP scraping limits at scale.

---

## 3. The parts (the chapters to come)

Each part is a future focused session: it gets its own brainstorm → spec → plan →
build (see §5). One paragraph each here — just enough to know what it is and where
the decisions are.

1. **Multi-tenant data model + backend skeleton.** Define the Supabase schema
   (shared roles pool + per-user profile/scores + encrypted `provider_credentials`),
   turn on Row-Level Security, and stand up the engine as a hosted service with a
   job queue. Nothing user-visible yet, but everything else depends on it. *Open:
   which Node host; queue technology; how `pipeline.md`/`digests` map to tables.*

2. **Onboarding — the 4 musts + nice-to-have.** The signed-in flow: connect LLM
   provider → connect LinkedIn (extension) → upload + parse CV → answer a few role
   questions → profile written to Supabase. *Open: the BYO-provider connection UX
   (the highest risk — prototype this first); CV-parsing approach; how few
   questions we can ask and still personalize well.*

3. **Shared sourcing layer.** Port `scan.mjs` (13 ATS + venture boards) to run
   server-side on a schedule, writing into the shared roles pool. *Open: scheduling
   cadence; dedup at multi-user scale; shared-IP rate-limit handling.*

4. **Per-user scoring + daily digest.** Parameterize `jd-score` + `triage` with the
   user's profile; score the shared pool **on the user's provider at their chosen
   effort tier**; run it **async and email when ready**; render the digest in the
   dashboard (the productized `morning-tables`). *Open: prompt parameterization;
   per-user cost ceilings even on BYO; what the dashboard digest looks like.*

5. **LinkedIn browser extension.** The central LinkedIn integration: a user-installed
   extension reading their own session client-side, syncing roles + network to the
   backend (feeding sourcing and warm-path boosts). *Open: extension vs. official
   "Sign in with LinkedIn" OAuth vs. both; Manifest V3 constraints; store review;
   ToS posture.*

6. **Audit feature.** Productize the company-audit artifact into the existing
   `audits` schema and `/a/:username/:slug` public pages. **Quality-first: multi-pass,
   more LLM calls** — the opposite of the current cheapened version — affordable
   precisely because compute is BYO. Runs async + notify. *Open: the audit pipeline
   (research → diagnosis → proposals); how it reuses sourcing data; publish flow.*

7. **Monetization.** With compute BYO, the core is free — so what, if anything, is
   paid? A premium / managed-compute tier for users who don't want to bring a key?
   The Stripe `purchases` schema exists but its role changes. *Open: whether to
   charge at all in v1; what the paid tier is.*

8. **Deployment, cron, cost controls, ops.** Productionize: hosting, scheduled runs,
   email/notification plumbing, secure key handling, observability, our own
   (non-LLM) cost controls. *Open: most of the infra specifics.*

---

## 4. Recommended build sequence

Dependency-driven, **backend foundation first** (you can't build features on
multi-tenant data that doesn't exist yet). Reorderable, but this is the order that
"makes sense from a product perspective":

| Order | Part | Why here |
|-------|------|----------|
| 1 | Multi-tenant data model + backend skeleton (Part 1) | Everything reads/writes this. |
| 2 | Onboarding + the 4 inputs (Part 2) | Produces the per-user profile + the provider key the rest needs. **Prototype the BYO-provider connection inside this step before trusting the whole model.** |
| 3 | Shared sourcing layer (Part 3) | Fills the roles pool that scoring consumes. |
| 4 | Per-user scoring + daily digest (Part 4) | The first real "wow" — a stranger sees a personalized shortlist. |
| 5 | LinkedIn extension (Part 5) | Upgrades sourcing + adds warm-path signal; richer, but the product works without it. |
| 6 | Audit feature (Part 6) | The differentiated feature, built on profile + roles already in place. |
| 7 | Monetization (Part 7) | Only meaningful once there's something worth paying for. |
| 8 | Deployment / ops hardening (Part 8) | Continuous, but formalized last. |

> **Validate-first gate.** Before committing to the full build, prove the
> **BYO-provider connection** end-to-end (a real user, a real key/OAuth, a real
> scored role on their compute). It's the load-bearing economic assumption; if it's
> too much friction, the model changes and several parts change with it.
>
> **Status (2026-05-31): prototype built + technically validated.** A mobile-first
> `/connect` page in the auditjobme repo (`src/pages/ConnectProvider.tsx`): pick
> provider (Claude / ChatGPT) → paste your own key → pick effort (low/med/high →
> model tier) → **Test connection** runs a *real* call **client-side** (browser →
> provider, the key never touches our servers). Verified the browser→Anthropic call
> goes all the way through (a bad key returns Anthropic's own `invalid x-api-key`,
> which only happens if CORS is allowed). **Open before relying on it:** (1) a
> real-key success run + a feel for the onboarding friction with a non-technical
> PM; (2) the production decision of where the key lives so *background* digest/audit
> jobs can run while the user is away (encrypted in Supabase vs. a session-scoped
> proxy — the existing `anthropic-proxy` edge function is the server-side template,
> but it currently burns *our* key, which is the trap BYO escapes).

> **v0.1 milestone = parts 1 → 4.** A stranger signs in, connects a provider,
> onboards (CV + LinkedIn), and sees a personalized scored digest generated on
> their own compute. That single flow proves both that the engine generalizes
> beyond one person *and* that the free/BYO economics work.

---

## 5. How we'll work + forward roadmap

**Per-part rhythm.** Each part above becomes its own session: brainstorm the design
→ write a spec at `docs/product/NN-<part>.md` → write an implementation plan →
build. Most of this is drivable from the phone via Claude Code — you open a part,
go deep, ship it, come back to this map. **This file is the index that ties the
parts together;** keep it current as parts land (check them off, link their specs).

**Forward roadmap.** Once v0.1 is real, the feature roadmap is **the same one
already in `ROADMAP.md`** — the data-source enrichment items (X / Twitter
digestion, Luma events, ESADE second-degree connections, Grok sentiment, and the
rest), now reframed for a multi-user product instead of one user. This document
**cross-links** `ROADMAP.md`; it does not duplicate or replace it.

---

*Foundation written 2026-05-31. Living document — update as parts land.*
