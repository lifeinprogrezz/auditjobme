# Data contract — engine ↔ web (v1 draft)

> The shared truth between the sourcing/scoring engine and the web app. Every agent task
> that touches data points here. Schema changes ALWAYS ship as Supabase migrations with
> human review (see CLAUDE.md hard rules) and update this document in the same PR.
> Status: DRAFT — table shapes settle when the Phase 2 migrations are written.

## Principles

1. **Shared pool, per-user lens.** Jobs are scraped once for everyone; scoring, tracking,
   and artifacts are per-user. Nothing per-user is ever computed at scrape time.
2. **RLS is the tenancy model.** Per-user tables enforce `user_id = auth.uid()`. Shared
   tables (companies, jobs) are read-only to clients; only the service role writes them.
3. **The client never enforces anything.** Allowances, caps, and visibility are enforced
   in edge functions and database policies. Client checks are UX, not security.
4. **Rubric versioning.** Every score records its `rubric_version`. Bumping the version
   invalidates cached scores lazily: the scorer re-scores rows whose version is older.
5. **Privacy default (locked 2026-06-13):** all user content — audits included — is
   private/unlisted by default. Publishing is an explicit user action that flips
   visibility and mints a public slug.

## Tables

### Shared (service-role writes, authenticated read)

**companies** — the tracked-company pool.
- `id` (pk) · `name` · `ats_type` (greenhouse | lever | ashby | smartrecruiters |
  workable | workday | factorial | google | meta | amazon | microsoft | apple | shopify |
  vc_board | startupmap) · `careers_url` · `hq_country` · `headcount_bucket` (nullable —
  no LinkedIn enrichment in the product; "unknown" is acceptable) · `status`
  (active | paused | requested) · timestamps.

**jobs** — the shared role pool (PM roles in Europe, the v1 ICP).
- `id` (pk) · `company_id` (fk) · `title` · `canonical_url` (unique — dedup key after
  URL canonicalization) · `location_raw` · `country` · `city` · `remote_mode`
  (onsite | hybrid | remote_eu | remote_global) · `posted_at` (nullable) ·
  `first_seen_at` · `last_seen_at` · `status` (live | dead | expired) · `jd_text` ·
  `jd_lang` · `source` (which scraper) · `uk_sponsor_licensed` (nullable boolean — from
  the UK Home Office register; null = unknown/ambiguous → shown with a warning, never hidden).

### Per-user (RLS: owner only)

**profiles**
- `user_id` (pk, fk auth.users) · `role_archetype` · `seniority_pref` ·
  `target_locations[]` · `citizenships[]` (drives work-authorization warnings) ·
  `languages[]` · `cv_text` (extracted from upload; the VERBATIM source for tailored CVs —
  never LLM-rewritten) · `cv_file_path` (storage) · timestamps.

**scores** — per user × job, the engine's output.
- `user_id` + `job_id` (composite pk) · `rubric_version` · `signals` (jsonb — the LLM
  signal breakdown) · `raw_score` · `effective_score` (after penalties/boosts) ·
  `scored_at`. Hard prefilters (geo, title, language) run BEFORE scoring — jobs failing
  them get no row, not a low score. That is the cost-control discipline.

**applications** — the tracker.
- `id` (pk) · `user_id` · `job_id` · `status` (saved | applied | responded | interview |
  offer | rejected | discarded) · `applied_at` (set by the MANUAL mark in v1) · `notes` ·
  timestamps. Cap-1 rule: one non-terminal application per (user, company) — enforced at
  write time in the edge function, surfaced in the digest query.

**artifacts** — generated audit / tailored CV / letter.
- `id` (pk) · `user_id` · `job_id` · `kind` (audit | cv | letter) · `storage_path` ·
  `visibility` (private | public — DEFAULT private) · `public_slug` (nullable, unique;
  minted only on explicit publish) · `model` · `cost_usd` · timestamps.

**usage_events** — every sponsored AI call.
- `id` · `user_id` · `kind` (score | audit | cv | letter) · `model` · `input_tokens` ·
  `output_tokens` · `cost_usd` · `created_at`. The per-user allowance check is
  `sum(cost_usd) < allowance` inside the edge function BEFORE the AI call; the global
  monthly kill-switch is a single counters row checked in the same place.

## Lifecycles

- **Job:** discovered → live → (dead | expired). Liveness checks flip status; dead jobs
  stay as rows (history) but leave every user's digest.
- **Score:** absent → scored(v) → stale when rubric_version > v → re-scored lazily on the
  next digest build for that user.
- **Audit/artifact job:** requested → running → (complete | failed). The client subscribes
  to the row; the edge function updates status. Failed jobs refund nothing (Haiku cents)
  but are retryable.
- **Application:** any → any forward status, manual in v1. Terminal: rejected | discarded.

## Writers / readers

| Actor | Writes | Reads |
|---|---|---|
| Scrape workflow (GitHub Actions, service role) | companies, jobs | companies |
| Scoring worker (edge function or queued job) | scores, usage_events | jobs, profiles |
| Artifact generation (edge functions) | artifacts, usage_events | jobs, profiles, scores |
| Client (browser, anon key + RLS) | profiles, applications, artifact visibility | own rows + shared jobs/companies |

## Open questions (settle during Phase 2 migrations)

- Whether scoring runs as Supabase edge functions per user or a queued batch worker
  alongside the scraper (v1 design spec Q12: decide when load is real).
- jd_text retention policy (full text forever vs. hash + window).
- Headcount: public substitute source vs. permanently "unknown".
- Exact allowance figure — from the economics pilot, not invented here.
