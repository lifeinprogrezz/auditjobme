-- CV-churn cost controls (#123). Applied to production 2026-08-19.
--
-- A CV edit used to run `delete from scores where user_id = ...`, so the worker
-- re-bought that user's whole slice. Measured on the real user: ~$29 before the
-- #114 prefilter, ~$3.69 after it, EVERY edit. Editing a CV is the core loop of
-- an active job seeker, so the most engaged user was the most expensive one. It
-- also blanked their map until the worker drained.
--
-- Scores are now kept and stamped with the CV they were computed from. A stale
-- score still shows a real number; the worker refreshes the best ones first, on
-- a budget, and only once editing has stopped.

alter table public.scores
  add column if not exists cv_hash text;

comment on column public.scores.cv_hash is
  'profiles.cv_hash at the moment this score was computed. A score whose cv_hash differs from the profile''s is STALE: still shown, re-bought highest-first on a per-pass budget (src/lib/scoreRefresh.ts). NULL means pre-#123 and counts as fresh, so existing scores are never re-bought wholesale.';

alter table public.profiles
  add column if not exists cv_changed_at timestamptz;

comment on column public.profiles.cv_changed_at is
  'When the CV text last actually changed (hash moved), NOT when the row was last written. The backlog worker waits for edits to go quiet before refreshing, so eight saves in one sitting cost one refresh rather than eight.';

alter table public.profiles
  add column if not exists stale_refreshed_at timestamptz;

comment on column public.profiles.stale_refreshed_at is
  'When this user last had a batch of stale scores refreshed. The backlog worker runs every 10 minutes, so a per-invocation budget alone would drain the whole tail in hours and defeat the pacing; the refresh is gated to at most one batch per STALE_REFRESH_INTERVAL_MS (src/lib/scoreRefresh.ts).';

-- Stamp every EXISTING score with the CV it was computed from, so the first run
-- after deploy does not treat the whole cache as unknown.
update public.scores s
set cv_hash = p.cv_hash
from public.profiles p
where p.id = s.user_id
  and s.cv_hash is null
  and p.cv_hash is not null;
