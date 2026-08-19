# Architecture

How Northgoing is built, for a developer (human or agent) landing in this repo for the
first time. Written 2026-07-25 (issue #60). Companion docs: [`DATA_CONTRACT.md`](./DATA_CONTRACT.md)
for the job-row schema, [`scoring-benchmarks.md`](./scoring-benchmarks.md) for scorer calibration.

## What the product does

It finds European tech roles, scores each one against *your* CV with a language model, and
prepares the application. The user-facing shape is a globe: roles clustered by city, ranked
by fit once a CV is on file.

**Product roles are the opening wedge, not the scope.** The ingestion and scoring path is
still product-only today — `scorePrompt.ts` hard-wires the discipline and `job-filters.mjs`
gates the pool — but the database and the interface are already vertical-agnostic:
`jobs.role_family` exists, and the headbar Role facet renders whatever families the rows
carry. Widening the engine is issue #34; nothing above it needs reshaping.

Three surfaces, all behind sign-in except the map:

- `/` — the globe. Anonymous visitors browse the whole live catalog; signed-in users with a
  CV get a fit-ranked "Best fit" rail.
- `/today` — the daily action queue: saved roles, a numbered top ten to apply to, then the
  rest of the matches.
- `/apply` and `/tracker` — the application bundle (tailored CV, cover letter, form-question
  answers) and a kanban of what you've sent.

## The shape of the system

```
 GitHub Actions (cron)          Vercel                    Supabase
 ─────────────────────          ──────                    ────────
 scrape.yml      05:00 UTC  →   api/nightly.ts        →   Postgres  (jobs, companies,
 nightly.yml     */10 6-9   →   api/score-backlog.ts  →              profiles, scores,
 score-backlog   */10 all day                                        daily_matches, …)
 deploy-edge-fns on push    →   the React SPA         →   anthropic-proxy (edge function)
                                                      →   Storage (dataplane artifacts)
```

Nothing here is a long-running server. Every moving part is either a scheduled job, a
serverless function with a 60-second ceiling, or the browser.

### Why the schedulers live in GitHub Actions

Vercel Hobby crons fire **once a day**. The scoring backlog and the nightly matcher both
need to run repeatedly to drain work within a serverless time budget, so GitHub Actions owns
the *trigger* (`curl` with `CRON_SECRET`) while the *work* stays in `api/` on Vercel. Read
the header comments in `.github/workflows/nightly.yml` and `score-backlog.yml` before
changing either — the split is deliberate, not accidental.

## The data plane

### Ingestion — `scripts/scrape.mjs`

Runs daily at 05:00 UTC. Reads `scripts/boards.json` (verified Greenhouse / Lever / Ashby /
Workable / SmartRecruiters / Teamtailor / Personio tokens) and the modules in `scripts/sources/`:

- `ats-extra.mjs` — SmartRecruiters, Workable, Workday, Factorial
- `teamtailor.mjs` — Teamtailor's official `{site}/jobs.json` syndication feed. One request
  per company, full description inline, no auth. Boards come in two flavours: `token` for a
  `*.teamtailor.com` subdomain, `host` for a custom career domain (`careers.macadam.app`),
  which is how most of the European tenants publish
- `personio.mjs` — Personio's public per-tenant `/xml` feed
  (`{token}.jobs.personio.de/xml`; the `.com` mirror serves the same document). One request
  per company, full description inline, no auth. Personio emits bare city names with no
  country, so the connector translates the European hub cities (native spellings included)
  into the shared filter's vocabulary
- `bigtech.mjs` — Google, Amazon, Microsoft, Apple (Meta is a documented known gap: its
  endpoint rejects datacenter and budget-residential IPs; only a premium proxy pool would
  change that, so the scraper skips it gracefully)
- `vc-startupmap.mjs` — venture portfolio boards plus startupmap.one
- `_proxy.mjs` — routes *only* the sources that need a residential exit through
  `SCRAPE_PROXY_URL`; everything else goes direct, keeping proxy bandwidth to a few hundred
  kilobytes a day

### Keeping the board list current — `scripts/sync-boards.mjs`

The personal career-ops engine resolves postings back to their applicant-tracking system
every night, so it learns about new company boards before the product does. This script
reads that engine's files (read only), pulls out every board token it has ever seen, drops
what `boards.json` already knows, verifies each remaining board against its public endpoint,
and with `--write` adds the live ones. It is idempotent, so a monthly
`node scripts/sync-boards.mjs --engine=<career-ops-dir> --write` is safe. Without it the
board list quietly falls behind and the diff gets done by hand again.

Rows are filtered by `job-filters.mjs`, enriched (`enrich-companies.mjs`,
`enrich-uk-sponsors.mjs`, `extract-jd.mjs`, `workplace-lib.mjs`) and upserted. **Rows missing
`company`, `title`, or `url` are dropped before the upsert with a logged count** — one null
company once failed an entire run, so the filter and its log line are load-bearing.

### Publication — `scripts/build-dataplane.mjs`

After each scrape, the catalog is written to a public Storage bucket as `dataplane.json` and
`jobs.ndjson`. The map fetches the artifact first and falls back to a live read, so an
anonymous visit to `/` is **one storage GET and zero database reads**.

### Scoring — two paths, one prompt

`src/lib/scorePrompt.ts` holds the rubric and its `RUBRIC_VERSION`. Both callers share it:

- **`api/score-backlog.ts`** (every 10 minutes) scores every CV-holding user's unscored live
  roles at the current rubric version, concurrency 8, inside a 45-second budget, upserting as
  results land. The backlog predicate is simply "a live job with no `scores` row at the
  current rubric" — a new CV, a changed CV, and a rubric bump all express themselves as
  backlog, so there is no queue table to keep consistent.
- **`api/nightly.ts`** (mornings) picks each active user's fresh labelled slice, ranks it, and
  sends one email through Resend.

The client does **not** score. `useRolesData.ts` polls the `scores` table every 20 seconds
while unscored roles remain. One scoring path means no double-spend and no work lost when a
tab closes.

**A cached score is forever** — the null-score filter never revisits a row. So never write a
degraded score: scoring is gated on `cv_text` being present, and a failed job-description
fetch must not produce a description-blind score.

### The language-model chokepoint

Every call goes through the `anthropic-proxy` edge function. Nothing calls Anthropic
directly, and the browser never holds the key. The proxy enforces a model allowlist, a `kind`
allowlist (`score`, `audit`, `cv`, `letter`, `answer`), and a `max_tokens` ceiling, then
records tokens, cost, and latency to `usage_events` server-side.

Spend caps were **deliberately removed** pre-launch; `usage_events` is the observability
surface a future cap will read. That is a settled decision, not an oversight (issue #35).

**When you add a request header, add it to the proxy's CORS allowlist in the same commit.** A
missing `x-region` entry once passed preflight and silently blocked every POST, killing CV
generation in browsers.

## The front end

Vite plus React plus TypeScript, single-page, no framework router beyond `react-router`.

- **Every non-landing route is lazily loaded.** Eager application JavaScript is about 99 kB;
  maplibre (~1 MB), pdfmake, and the PDF text extractor are separate chunks that load on
  first use. Check `manualChunks` in `vite.config.ts` before adding a heavy dependency.
- **`src/components/roles/GlobeMap.tsx`** owns the map. It renders on `requestAnimationFrame`,
  which Chrome suspends in background tabs — a hidden tab will show a blank canvas and never
  fire `load`. That is browser behavior, not a bug; **verify `document.visibilityState`
  before diagnosing any map timing problem.** A real foreground cold load settles in under
  four seconds.
- **`src/lib/` is where logic lives, and it is where the tests point.** Components stay thin;
  anything worth pinning gets extracted (`roles.ts`, `nightly.ts`, `scoreBacklog.ts`,
  `tracker.ts`, `labels.ts`, `tailor.ts`, `cvHtml.ts`, `pdf.ts`).

### Two trust rules that are not negotiable

1. **The CV body is rendered verbatim from the user's `cv_text`** (`cvHtml.ts`, `pdf.ts`).
   The only generated text is the tailored summary. Never reorder, reword, or drop a line of
   someone's CV.
2. **Generated PDFs carry a real text layer** (pdfmake, never a rasterized page image), or
   applicant tracking systems cannot parse them and the feature is worse than useless.

Both are pinned by tests. Change either only alongside its test.

## Database conventions

Migrations are plain SQL in `supabase/migrations/`, timestamp-prefixed (39 today).

- **The timestamp must be unique.** Two sessions once stamped the same minute and collided;
  CI now has an ephemeral-database check that catches duplicate versions.
- **Apply through the Supabase MCP `apply_migration`, then mirror the file into the repo** so
  the repository stays the canonical record.
- **The project reference of record is `VITE_SUPABASE_URL` in the frontend `.env`**, not
  `config.toml` — a stale reference in `config.toml` once mis-aimed tooling at a dead project.

Row-level security is the enforcement layer; client-side checks are decoration. Per-user
tables expose own-row policies only. `usage_events` is **not** client-writable — the proxy
writes it with the service role — because a client-writable meter with no non-negative
constraint is a spend-cap bypass. Wrap `auth.uid()` as `(select auth.uid())` in policies so
Postgres hoists it out of the row loop.

## Environment

Client (`VITE_`-prefixed, baked into the bundle, all public by design):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_LOGODEV_TOKEN`,
`VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_E2E_BYPASS_AUTH`.

Server (Vercel environment and GitHub secrets, never in the bundle):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
`CRON_SECRET`, `SCRAPE_PROXY_URL`.

`SUPABASE_SERVICE_ROLE_KEY` must be the legacy `eyJ…` service-role JWT. Note that the
dashboard's service-role token and the one an edge function receives are *different but both
valid* JWTs, so never compare them by string equality — validate the decoded `role` claim
after the gateway has verified the signature.

## Deploying

Two stages, no preview environments:

- **`localhost:8080`** — `npm run dev`. It talks to the *production* Supabase, so saving a
  role or marking one applied writes real rows.
- **`main` → northgoing.com** — pushing to `main` deploys the frontend on Vercel, and any commit
  touching `supabase/functions/**` deploys the edge function through
  `deploy-edge-functions.yml`. One push ships both. The old `auditjob.me` still resolves
  and 308-redirects to `northgoing.com` (`vercel.json`), except under `/api`, which both
  hosts continue to serve.

Branch preview deployments are disabled in `vercel.json` (`git.deploymentEnabled`). They
caused two stale-build reviews and reviewed nothing.

`vite dev` does **not** run `api/*` or the edge function. Anything touching those gets checked
on production right after deploy — five bugs in the nightly pipeline were runtime-only and
invisible to green tests and four reviewers.

## Local setup

```bash
npm ci
cp .env.example .env     # fill in the VITE_ values
npm run dev              # http://localhost:8080
```

Requires Node 24, which is what continuous integration runs.

## Testing

```bash
npm run typecheck   # tsc -p tsconfig.app.json && tsc -p api/tsconfig.json
npm run lint
npm run test        # vitest, ~358 tests across 33 files
npm run build
```

**Run `npm run typecheck`, never a bare `tsc --noEmit`.** The root config is loose; the two
project configs above are what continuous integration enforces. Bare `tsc` has passed clean
on code that CI rejected.

`scripts/verify-smoke.mjs` walks the canonical path against a running build, including an
authenticated pass. It is the closest thing to an end-to-end test and it is not part of the
offline gate — run it deliberately.

The gate in `.github/workflows/ci.yml` is lint, typecheck, test, and build, all blocking,
plus a secrets scan and the migration and row-level-security check.
