-- Scrape watchdog on the server-side scheduler (2026-08-27).
--
-- Three workers moved to pg_cron earlier today (20260827170000): the free GitHub
-- Actions scheduler starved, no scheduled run fired between 03:00 and 11:00 UTC,
-- and every manual trigger was green. The scrape workflow could not follow them.
-- It is a ten-step Node pipeline that needs a runner, the service-role key and
-- minutes of runtime, and tick_worker can only make one HTTP call. So the scrape
-- keeps its GitHub schedule and gets a watchdog on the scheduler that works.
--
-- The watchdog checks that the LAST step of that pipeline published a fresh
-- dataplane artifact to Storage, and emails the owner when it did not. Where a
-- GitHub token is present it also restarts the workflow, at most once a day.
-- Logic and fail-safe rule: api/scrape-watchdog.ts + src/lib/scrapeWatchdog.ts,
-- pinned by src/lib/scrapeWatchdog.test.ts.
--
-- This EXTENDS tick_worker rather than adding a second caller: same Vault secret,
-- same allowlist, same no-op while no secret exists. The only change to the
-- function is one more allowed worker name. No new table, so no new row-level
-- security surface: the freshness signal is a Storage row that already exists.
--
-- 08:00 UTC is three hours after the scrape workflow's 05:00 schedule, which
-- leaves the whole pipeline room to finish before anyone is told it did not.
create or replace function public.tick_worker(worker text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  if worker not in ('nightly', 'score-backlog', 'spend-alert', 'scrape-watchdog') then
    raise exception 'tick_worker: unknown worker %', worker;
  end if;

  select vs.decrypted_secret into v_secret
    from vault.decrypted_secrets vs
   where vs.name in ('cron_secret_db', 'cron_secret')
   order by case vs.name when 'cron_secret_db' then 0 else 1 end
   limit 1;

  if v_secret is null or length(btrim(v_secret)) = 0 then
    raise notice 'tick_worker(%): no cron secret in vault yet, skipping', worker;
    return;
  end if;

  select net.http_post(
           url := 'https://northgoing.com/api/' || worker,
           body := '{}'::jsonb,
           params := '{}'::jsonb,
           headers := jsonb_build_object(
             'Authorization', 'Bearer ' || v_secret,
             'Content-Type', 'application/json'
           ),
           timeout_milliseconds := 60000
         )
    into v_request_id;

  raise notice 'tick_worker(%): request %', worker, v_request_id;
end;
$$;

comment on function public.tick_worker(text) is
  'Calls one of our own Vercel workers with the cron secret held in Vault (cron_secret_db, or cron_secret if that is the one present). No-ops while neither exists. Called only by pg_cron jobs; never granted to anon or authenticated.';

revoke all on function public.tick_worker(text) from public, anon, authenticated;

select cron.unschedule('northgoing-scrape-watchdog') where exists (select 1 from cron.job where jobname = 'northgoing-scrape-watchdog');

select cron.schedule('northgoing-scrape-watchdog', '0 8 * * *', $$select public.tick_worker('scrape-watchdog')$$);
