# Scoring benchmarks — cost / tokens / time

**Purpose.** Baseline reference numbers for the per-user role-scoring workload, so we
can tune the model, prompt size, batch size, and timing against real data later.
Established 2026-07-09. Append every re-measurement to the **Runs log** at the bottom.

## Source of truth — `usage_events` (real, not estimated)

Every LLM call routes through the `anthropic-proxy` edge function, which writes one
`usage_events` row per call for the spend guardrails: **real `input_tokens`,
`output_tokens`, `cost_usd`** (and, since 2026-07-09, **`latency_ms`** — the
proxy→Anthropic inference round-trip). So per-score cost/tokens/latency are **measured**,
not derived. Scoring rows are `kind = 'score'`. Re-measure any time with the queries in
the Runs-log note. (`usage_events` does not store `rubric_version`; segment current-prompt
scores by `created_at >= <date the rubric shipped>`.)

## The workload

- **What:** score how well each live role fits a signed-in user's Curriculum Vitae (CV), 0–5.
- **Model:** `claude-haiku-4-5-20251001` — list price **$1.00 / MTok input, $5.00 / MTok output**.
- **Where it runs:** **client-side**, in the browser, on `/roles` (`useRolesData.ts` → `scoreJob`
  → `anthropic-proxy` → Claude). **Serial** — one role at a time. **40 roles per page load**
  (`slice(0, 40)`); `scoreMore` does the next 40. `max_tokens: 500` (never hit).
- **Cache:** one `scores` row per `(user_id, job_id, rubric_version)`; a role is scored **once
  per rubric version** and reused. Bumping `RUBRIC_VERSION` lazily re-scores on next load.
- **Not this workload:** the nightly matcher (`api/nightly.ts`, Vercel cron) is a *separate*
  server-side pass that writes `daily_matches` (the email), not `scores`. It shares the proxy,
  so its scores land in `usage_events` too — segment by user/time if you need to split them.
- **Prompt caching:** not used. SYSTEM (~350 tok) + CV (~540 tok) shared prefix is below Haiku's
  2,048-tok cacheable minimum — caching wouldn't trigger without padding. Future lever.

## Baseline (measured 2026-07-09, from `usage_events`)

### Current prompt (`v3`, shipped 2026-07-09) — the number that matters going forward

108 scores. This is the real cost of a current, grounded (`v3`, with fit-bullets) score.

| Metric | avg | p50 | p90 | max |
|---|---|---|---|---|
| Input tokens | **1,195** | 1,035 | 1,614 | 1,753 |
| Output tokens | **203** | 201 | 238 | 279 |

| | value |
|---|---|
| **Cost per score** | **~$0.0022** |
| Per 40-role load | ~$0.088 |
| **Full catalog (764 roles / user)** | **~$1.69** |

### All-time (since 2026-06-14, 1,259 scores — mixes older rubric versions)

Lower than v3 because v1/v2 had shorter prompts (no fit-bullets) and many empty-JD / short-CV
test scores. Kept for context; use the v3 row above for planning.

| Input avg | Output avg | $/score | Total spent on scoring |
|---|---|---|---|
| 602 (p50 373) | 77 (p50 64) | ~$0.00099 | $1.24 (1,259 scores) |

### Latency

Now captured in `usage_events.latency_ms` (rows before 2026-07-09 are NULL). Query it after the
next scoring pass runs for the real per-score inference time. Prior working estimate: ~1.5–3 s/score
(serial, Haiku); ~1.5–2 min per 40-role load; ~30 min for a full 764-role catalog across ~19 loads.

> Scoring **stops when the user leaves `/roles`** (the effect cleanup cancels the loop) — it does
> NOT continue server-side for that account. Computed scores are persisted, so returning resumes
> the next unscored batch. Moving this to a server-side pass (like the nightly) is a tracked issue.

### Catalog snapshot (2026-07-09)

- Live jobs: **764**.

## Tuning levers (what these numbers let us decide later)

- **Model swap** — Haiku → cheaper/faster or stronger: recompute cost = tokens × new price;
  compare `latency_ms` distributions before/after.
- **CV / JD caps** — the 2,000 / 3,000-char slices (`scorePrompt.ts`) are the biggest input-token
  levers. Real v3 input is ~1,195 avg, so the caps already bound it well; halving the JD cap trades
  ~a few hundred input tok/score against score quality.
- **Batch size** — 40/load is a cost + latency cap, not a quality knob.
- **Prompt caching** — only pays off if the stable SYSTEM+CV prefix is pushed past 2,048 tok on Haiku.

## Runs log

Append one row per measurement pass. Keep it terse; detail goes in the prose above.

| Date | Source | Model | In tok/score | Out tok/score | $/score | $/full-catalog | Notes |
|---|---|---|---|---|---|---|---|
| 2026-07-09 | `usage_events` (v3-era, 108 scores) | haiku-4-5 | 1,195 avg | 203 avg | ~$0.0022 | ~$1.69 (764) | REAL. Current grounded prompt; CV cap 2k / JD cap 3k; serial client-side, 40/load |
| 2026-07-09 | `usage_events` (all-time, 1,259 scores) | haiku-4-5 | 602 avg | 77 avg | ~$0.00099 | — | REAL but mixes v1/v2 (shorter prompts) + empty-JD test scores |

> Re-measure (v3-era slice): `select round(avg(input_tokens)) in_avg, round(avg(output_tokens)) out_avg,`
> `round(avg(cost_usd)::numeric,5) cost_avg, round(avg(latency_ms)) ms_avg, count(*) n`
> `from usage_events where kind='score' and model='claude-haiku-4-5-20251001' and created_at >= '2026-07-09';`
