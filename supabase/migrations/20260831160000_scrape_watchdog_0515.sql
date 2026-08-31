-- Move the scrape watchdog check from 08:00 to 05:15 UTC (2026-08-31).
--
-- The 08:00 slot rescued the POOL but not the DIGEST: the nightly scorer fires
-- at 06:00 UTC, so on a morning where GitHub dropped the scrape schedule
-- entirely (8-31: no scheduled run at all; 8-29/8-30 drifted past 10:00) the
-- watchdog's restart landed two hours AFTER the digest had already matched a
-- day-old pool — 1 match on 8-31 against 18 the day before.
--
-- At 05:15 the ordering closes: the scrape now runs at 03:47 UTC (scrape.yml,
-- moved off the congested :00 slot the same day), so a healthy artifact is
-- about 1.5 hours old at check time and a missed run about 25.5 hours old —
-- both far from the 12-hour staleness line (STALE_AFTER_HOURS,
-- src/lib/scrapeWatchdog.ts). A restart dispatched at 05:15 finishes in about
-- ten minutes, republishing the dataplane well before the 06:00 scorer. The
-- once-a-day dispatch guard (DISPATCH_MIN_GAP_HOURS = 20) also clears: same
-- minute daily means the previous restart is ~24 hours old at the next check.
--
-- Only the schedule moves. tick_worker, its allowlist and the Vault secret
-- lookup are untouched (20260827200000_scrape_watchdog.sql).

select cron.unschedule('northgoing-scrape-watchdog') where exists (select 1 from cron.job where jobname = 'northgoing-scrape-watchdog');

select cron.schedule('northgoing-scrape-watchdog', '15 5 * * *', $$select public.tick_worker('scrape-watchdog')$$);
