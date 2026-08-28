-- Halve the worker tick interval, 10 minutes to 5 (2026-08-28).
--
-- The interval is dead time a user waits through. A new signup's first scores
-- are collected by the score-backlog worker, so up to ten minutes can pass
-- before any work even STARTS on them; the same gap sits in front of every
-- resumed chunk after that. Measured on the 2026-08-26 signup: first scores
-- landed 9.7 minutes after sign-up, which is almost exactly one wasted tick.
--
-- This is now cheap to change. While these workers ran on GitHub Actions the
-- interval was a shared free-tier queue that was already starving (see
-- 20260827170000). On pg_cron a tick is one HTTP call the project already pays
-- for, and both workers no-op in milliseconds when there is nothing to do:
-- today's ticks return `processed: 0, done: 2` in about four seconds.
--
-- Cost is unchanged. Neither worker buys anything a slower tick would not have
-- bought: the nightly skips a user already emailed today, the backlog is bounded
-- by STALE_REFRESH_BUDGET per pass AND by STALE_REFRESH_INTERVAL_MS between
-- passes (src/lib/scoreRefresh.ts), and that six-hour spacing is deliberately
-- NOT touched here. Doubling the ticks doubles the no-ops, not the purchases.
--
-- The nightly's window stays 06:00-09:50 UTC, after the 05:00 scrape.
select cron.unschedule('northgoing-nightly') where exists (select 1 from cron.job where jobname = 'northgoing-nightly');
select cron.unschedule('northgoing-score-backlog') where exists (select 1 from cron.job where jobname = 'northgoing-score-backlog');

select cron.schedule('northgoing-nightly', '*/5 6-9 * * *', $$select public.tick_worker('nightly')$$);
select cron.schedule('northgoing-score-backlog', '*/5 * * * *', $$select public.tick_worker('score-backlog')$$);
