# auditjob.me — the product (public repo)

Free product for Product Managers job-hunting in Europe: daily-scraped job pool, scored
against YOUR profile, with an apply bundle (tailored CV + letter + company audit) and an
application tracker. This repo is **public (MIT)** — never commit secrets, strategy docs,
or personal data. Design authority: the v1 design spec (private planning repo,
`docs/specs/2026-06-13-agent-built-auditjobme-v1-design.md`); agents get task-level
context via GitHub Issues.

## Stack & layout
- Vite + React + TypeScript, Tailwind + shadcn/ui, React Router, TanStack Query.
- Supabase: Postgres + Google auth + edge functions; SQL in `supabase/migrations/`
  (schema changes ALWAYS go through migrations + human review — never the dashboard).
- `src/pages/` routes · `src/components/` · `src/integrations/supabase/` (regenerate
  `types.ts` after any schema change — it's generated, never hand-edit).
- Hosted on **Vercel** (preview per PR, production on main). Lovable is disconnected —
  ignore `.lovable/`.

## Economics — sponsored compute (v1)
Free-cohort AI calls run server-side via the `anthropic-proxy` edge function on OUR
capped key, **Haiku only**. Enforcement lives in edge functions + DB (per-user $
allowance, global monthly kill-switch, device-fingerprint guard) — NEVER in the client
(this repo is public; client checks are decoration). `src/pages/ConnectProvider.tsx` is
the PARKED future bring-your-own-key tier: not routed, don't extend it.

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
