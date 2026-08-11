-- Issue #68 item 1: nightly liveness sweep over the immortal-class sources
-- (vc:*, startupmap, workday, factorial, bigtech, seed) — the only retirement
-- path for rows the board-diff never re-scans. The sweep rotates
-- oldest-checked-first, so it needs a per-row check timestamp.
-- Rollback = drop the index + column.

alter table public.jobs add column liveness_checked_at timestamptz;

-- Partial index for the sweep's working set: live rows ordered by last check
-- (nulls first = never-checked rows go to the front of the rotation).
create index idx_jobs_liveness_sweep
  on public.jobs (liveness_checked_at asc nulls first)
  where is_live = true;
