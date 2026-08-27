-- Server-side scheduler for the HTTP workers (2026-08-27).
--
-- GitHub Actions cron is best-effort and starves. On 2026-08-27 not one scheduled
-- run fired between 03:00 and 11:00 UTC: no 05:00 scrape, no 06:00-09:50 nightly
-- window, one backlog tick all morning, with GitHub Actions reporting no incident.
-- Every manual trigger of the same workflows ran green, so the workers are fine and
-- the scheduler is not. pg_cron runs inside the database the project already pays
-- for, so the schedule no longer depends on a free-tier queue.
--
-- The secret never lives in this file. tick_worker reads it from Supabase Vault
-- (secret name 'cron_secret') and, while that secret is absent, does NOTHING: no
-- request, no 401 storm. The worker name is checked against an allowlist so the
-- function can only ever call our own endpoints.
--
-- The GitHub workflows stay in place as a second belt. Both callers are idempotent
-- (the shared scores ledger, issue #135), so a doubled tick costs a read, never a
-- double purchase.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

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
  if worker not in ('nightly', 'score-backlog', 'spend-alert') then
    raise exception 'tick_worker: unknown worker %', worker;
  end if;

  select vs.decrypted_secret into v_secret
    from vault.decrypted_secrets vs
   where vs.name = 'cron_secret'
   limit 1;

  if v_secret is null or length(btrim(v_secret)) = 0 then
    raise notice 'tick_worker(%): no cron_secret in vault yet, skipping', worker;
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
  'Calls one of our own Vercel workers with the CRON_SECRET held in Vault (secret name cron_secret). No-ops while that secret is absent. Called only by pg_cron jobs; never granted to anon or authenticated.';

revoke all on function public.tick_worker(text) from public, anon, authenticated;

select cron.unschedule('northgoing-nightly') where exists (select 1 from cron.job where jobname = 'northgoing-nightly');
select cron.unschedule('northgoing-score-backlog') where exists (select 1 from cron.job where jobname = 'northgoing-score-backlog');
select cron.unschedule('northgoing-spend-alert') where exists (select 1 from cron.job where jobname = 'northgoing-spend-alert');

select cron.schedule('northgoing-nightly', '*/10 6-9 * * *', $$select public.tick_worker('nightly')$$);
select cron.schedule('northgoing-score-backlog', '*/10 * * * *', $$select public.tick_worker('score-backlog')$$);
select cron.schedule('northgoing-spend-alert', '0 10 * * *', $$select public.tick_worker('spend-alert')$$);
