# Scoring benchmarks — cost / tokens / time

**Purpose.** Baseline reference numbers for the per-user role-scoring workload, so we
can tune the model, prompt size, batch size, and timing against real data later.
Established 2026-07-09. Append every re-measurement to the **Runs log** at the bottom.

> **Measured vs estimated.** Character counts here are **measured** (Supabase, 2026-07-09).
> Token counts are **derived** from chars at **~3.7 chars/token** (Claude tokenizer, English
> prose with bullets/punctuation) — treat them as ±15% until we capture real `usage` from the
> API. Cost is derived from tokens × list price. Time is **estimated** (not yet instrumented).

## The workload

- **What:** score how well each live role fits a signed-in user's Curriculum Vitae (CV), 0–5.
- **Model:** `claude-haiku-4-5-20251001` — list price **$1.00 / MTok input, $5.00 / MTok output** (200K ctx).
- **Where it runs:** **client-side**, in the browser, on the `/roles` page (`useRolesData.ts`
  → `scoreJob` → `anthropic-proxy` edge function → Claude). **Serial** — one role at a time.
- **Batch:** **40 roles per page load** (`slice(0, 40)`); `scoreMore` does the next 40. Cost cap.
- **`max_tokens`: 500** (never hit — see output size below).
- **Cache:** one row per `(user_id, job_id, rubric_version)` in `scores`. A given role is scored
  **once per rubric version** and reused. Bumping `RUBRIC_VERSION` lazily re-scores on next load.
- **Not this workload:** the nightly matcher (`api/nightly.ts`, Vercel cron) is a *separate*
  server-side pass that writes `daily_matches` (the email), **not** `scores`. Benchmark it separately.
- **Prompt caching:** **not used.** SYSTEM (~350 tok) + CV (~540 tok) = ~890 tok shared prefix,
  below Haiku's 2,048-tok cacheable minimum — caching wouldn't trigger without padding. Future lever.

## Baseline (2026-07-09)

### Prompt size per score

| Part | Measured chars | ~Tokens @3.7 | Notes |
|---|---|---|---|
| SYSTEM prompt | ~1,300 | ~350 | Fixed rubric (`scorePrompt.ts`) |
| Profile + role labels | ~280 | ~75 | Fixed scaffold lines |
| CV (capped `.slice(0,2000)`) | 2,000 | ~540 | User CVs exceed the 2,000-char cap → always full |
| JD (capped `.slice(0,3000)`) | 1,655 avg · 3,000 p50/p90 | ~445 avg · ~810 full | ~half of JDs hit the 3,000 cap |
| **Input total** | | **~1,420 avg · ~1,785 full-JD** | typical **~1,600 input tokens** |
| **Output** (score + reason + 3–5 bullets) | 779 avg · 1,027 max | **~220 avg · ~290 max** | well under the 500 cap |

### Cost per score (Haiku list price)

| | Tokens | Cost |
|---|---|---|
| Input | ~1,600 | $0.00160 |
| Output | ~220 | $0.00110 |
| **Per score** | | **~$0.0027** (range $0.0024 short-JD → $0.0031 full-JD) |
| Per 40-role load | | **~$0.11** |
| **Full catalog cold (764 roles / user)** | | **~$2.06** |

### Time (ESTIMATED — not yet instrumented)

Serial, client-side; each score = 1 edge-function round-trip + Haiku inference + parse + 1 upsert.

- Per score: **~1.5–3 s** (Haiku is fast; dominated by round-trips).
- Per 40-role load: **~1.5–2 min**.
- Full 764-role catalog: **~30–35 min** of active `/roles` time, across ~19 loads (40/load).

> Scoring **stops when the user leaves `/roles`** (the effect cleanup cancels the loop) — it does
> NOT continue server-side for their account. Computed scores are persisted, so returning resumes
> the next unscored batch. Full-catalog time above assumes staying on the page / repeated loads.

### Catalog snapshot (2026-07-09)

- Live jobs: **764** · Rober's `v3` scores so far: **60** (grows ~40 per `/roles` load).

## How to capture REAL numbers (replace the estimates)

The proxy already gets Claude's `usage` (`input_tokens` / `output_tokens`) on every response —
it just isn't surfaced. To turn this doc from estimated → measured:

1. Have `anthropic-proxy` return `usage` to the client (and/or log it).
2. Record per-score `input_tokens`, `output_tokens`, and wall-clock latency (a few sampled scores
   is enough for a baseline).
3. Append a dated row to the Runs log with the real averages.

Until then, re-derive from chars via the query in the Runs-log note below when the CV or JD caps change.

## Tuning levers (what these numbers let us decide later)

- **Model swap** — Haiku → a cheaper/faster or stronger model: recompute cost = tokens × new price.
- **CV / JD caps** — the 2,000 / 3,000-char slices are the biggest input-token levers. Halving the
  JD cap cuts ~200 input tok/score (~12% input cost) — trade against score quality.
- **Batch size** — 40/load is a cost + latency cap, not a quality knob.
- **Prompt caching** — only pays off if we push the stable SYSTEM+CV prefix past 2,048 tokens on Haiku.

## Runs log

Append one row per measurement pass. Keep it terse; detail goes in the prose above.

| Date | Source | Model | In tok/score | Out tok/score | $/score | $/full-catalog | Notes |
|---|---|---|---|---|---|---|---|
| 2026-07-09 | estimated (chars×3.7) | haiku-4-5 | ~1,600 | ~220 | ~$0.0027 | ~$2.06 (764) | baseline; CV cap 2k / JD cap 3k; serial client-side, 40/load |

> Re-measure chars with: `select round(avg(least(length(coalesce(jd_text,'')),3000))) from jobs where is_live` (JD),
> `length(cv_text)` on the profile (CV), and `avg(length(signals::text))` on `scores` where `rubric_version` (output).
