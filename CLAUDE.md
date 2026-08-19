# Northgoing — the product (public repo)

Free product for job-hunting in Europe: daily-scraped job pool across five role
verticals (`jobs.role_family`: product · engineering · sales · marketing ·
operations — Design and Data/AI analyst/scientist seats deferred; issue #34),
scored against YOUR profile with a per-family rubric, with an apply bundle
(tailored CV + letter + company audit) and an application tracker. This repo is **public (MIT)** — never commit secrets, strategy docs,
or personal data. Design authority: the v1 design spec (private planning repo,
`docs/specs/2026-06-13-agent-built-auditjobme-v1-design.md`); agents get task-level
context via GitHub Issues.

## Stack & layout
- Vite + React + TypeScript, Tailwind + shadcn/ui, React Router, TanStack Query.
- Supabase: Postgres + Google auth + edge functions; SQL in `supabase/migrations/`
  (schema changes ALWAYS go through migrations + human review — never the dashboard).
- `src/pages/` routes · `src/components/` · `src/integrations/supabase/` (regenerate
  `types.ts` after any schema change — it's generated, never hand-edit).
- Hosted on **Vercel**: `main` deploys to production (northgoing.com; the old
  `auditjob.me` redirects there, and the Vercel PROJECT is still named `auditjobme`).
  Branch preview
  deployments are disabled in `vercel.json` — review on `localhost:8080`, not a preview URL.

## Economics — sponsored compute (v1)
Free-cohort AI calls run server-side via the `anthropic-proxy` edge function on OUR
capped key, **Haiku only** (target state — the legacy AuditGenerator pipeline still
calls Sonnet; migrate it when the caps land). **Scoring nobody is waiting on goes
through the proxy's service-role batch ops (`batch_submit`/`batch_poll`/`batch_results`)
for a flat 50% discount** — same model, same rubric bytes, same validator, so it is a
cost change and never a judgment change; in-flight state lives in `score_batches` and
`usage_events.batch` splits the ledger. Batch has no latency guarantee, so it is never
on a user-facing path: a new user's first `SYNC_ONBOARDING_SLICE` roles stay synchronous
(`src/lib/scoreBatch.ts`, pinned by `src/test/score-batch.test.ts`; issue #96).
Enforcement lives in edge functions + DB (per-user $
allowance, global monthly kill-switch, device-fingerprint guard) — NEVER in the client
(this repo is public; client checks are decoration). The PARKED future
bring-your-own-key tier's `ConnectProvider` prototype was deleted in #57
(commit 9d48a10) — it's preserved in git history, not in the tree; don't
resurrect it into v1.

## Hard rules
1. **CV trust rule:** the user's CV body is never rewritten by an LLM — rendered verbatim
   from their upload. LLM output = professional summary + cover letter only.
2. **RLS is the security model.** Every table gets row-level-security policies, tested in
   CI. Assume every reader of this code is hostile.
3. **No secrets in this repo, ever.** `VITE_`-prefixed Supabase publishable values in
   `.env` are public by design and fine. Real keys (`ANTHROPIC_API_KEY`, service-role)
   live in Supabase function env / Vercel env / GitHub Actions secrets.
4. **Brand & copy:** follow `BRAND.md`. User-facing copy: warm voice, no em-dashes, no
   AI-tells, abbreviations expanded on first use.
5. **Job sources are public-only** (ATS-direct, big-tech careers endpoints, VC boards,
   startupmap.one, UK sponsor register). No LinkedIn, no authenticated scraping.

## Commands
`npm run dev` (port 8080) · `npm run build` · `npm test` (vitest) · `npm run lint`

**Verifying an authed surface** (/today, /tracker, /apply) without credentials:
`VITE_E2E_BYPASS_AUTH=1 npm run dev`. Dev-only and double-gated on `import.meta.env.DEV`,
so a production build folds it out. It hands RequireAuth a mock user AND (via
`src/lib/devFixture.ts`) synthetic scores + a synthetic nightly batch over the real
public pool, so the queue, the New section, dismiss and "+N more from {company}" all
render. The mock carries no JWT: every row is labelled a fixture, nothing persists,
and RLS stays the only enforcement. Never verify a data-persistence claim through it.
