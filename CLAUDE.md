# auditjob.me — Public Web App (repo 3 of 3)

## What this repo is

The public, user-facing web product for **auditjob.me**: the shell (landing page, auth,
public audit display, AI-provider connection flow). Built in **[Lovable](https://lovable.dev)**,
so Lovable is the canonical visual editing surface — but this is real code and can be edited
directly (git / Claude Code / mobile). Changes can arrive from *both* directions; **pull before
you edit** so you don't fork against a Lovable-origin commit.

## Where this sits — the 3-repo product

auditjob.me = the personal `career-ops` engine, opened up as a **free product for other
Product Managers** (Europe-first). The company audit ("show them you already did the job") is
*one* feature; the daily sourcing + scoring digest is the core. **Economic spine: free +
bring-your-own-compute** — each user connects their own AI provider and their key pays for the
scoring/audit calls (proxied server-side, never shipped to the browser).

| # | Repo | Role |
|---|------|------|
| 1 | `lifeinprogrezz/auditjobme-careerops-planning` | **The map.** `PRODUCT.md` = what we're building + what's next; `ROADMAP.md` = engine features. Start product sessions here. |
| 2 | `lifeinprogrezz/career-ops-rober` | The engine (Node CLI: sourcing, scoring, digests). The capability behind this shell. |
| 3 | `lifeinprogrezz/auditjobme` | **This repo** — the web shell. |

For "what should I build next," read **`PRODUCT.md` in repo 1** — it's written to be the
phone-drivable map of the whole merge.

## Stack

- **Vite + React + TypeScript**, Tailwind + **shadcn/ui** (Radix), React Router, TanStack Query,
  react-hook-form + zod.
- **Supabase** backend: Postgres + auth (Google sign-in), Edge Functions, SQL migrations.
- FingerprintJS (`device_fingerprints` — abuse / free-tier guard).

## Layout

- `src/pages/` — routes: `Index` (landing), `ConnectProvider` (bring-your-own-provider
  connection — the **current build front**), `PublicAudit` (`/a/:username/:slug` public audit
  display), `Privacy`, `Terms`, `NotFound`.
- `src/components`, `src/hooks`, `src/lib`, `src/integrations` (Supabase client).
- `supabase/functions/` — **server-side; real secrets live HERE, not in the client repo:**
  - `anthropic-proxy` — proxies the user's AI-provider calls (the bring-your-own-compute mechanism).
  - `create-payment` / `verify-payment` — Stripe.
- `supabase/migrations/` — DB schema. Tables: `audits`, `profiles`, `purchases`,
  `whitelisted_emails`, `device_fingerprints`, `feedback`.

## Commands

- `npm run dev` — local dev server (Vite) · `npm run build` / `npm run preview`
- `npm run lint` (eslint) · `npm test` (vitest)

## Conventions / gotchas

- **`.env` is committed and that's fine here:** it holds only `VITE_`-prefixed Supabase values
  (`PROJECT_ID`, `URL`, `PUBLISHABLE_KEY`). `VITE_` vars ship to the browser by design, and the
  publishable/anon key is *meant* to be public (Row-Level Security protects the data). **Real
  secrets (Stripe, AI-provider keys) live in Supabase Edge Function env — never add an
  `sk_…` / `service_role` key to this repo's `.env`.**
- **Brand:** sage `#8a9a8a` on dark charcoal (see `tailwind.config.ts` / PRODUCT.md §1). Keep
  audit/display pages brand-aligned: white background, no AI-tells.
- **Built in Lovable** → expect occasional Lovable-origin commits; reconcile before large refactors.
- **Status** (per PRODUCT.md): today this is a display + auth + marketing shell plus the
  bring-your-own-provider connection prototype. **Not built yet:** the sourcing/scoring engine
  behind it, dashboards, profile ingestion. The engine lives in repo 2.
