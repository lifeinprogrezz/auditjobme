-- The database's own cron secret (2026-08-27).
--
-- Vercel env vars of type Secret are write-only: the existing CRON_SECRET cannot
-- be read back to copy into Vault, and rotating it would mean changing Vercel, the
-- GitHub repo secret and Vault together, with every caller unauthorized in between.
-- So the database gets its OWN secret instead: CRON_SECRET_DB in Vercel, the same
-- value as a Vault secret named cron_secret_db. The endpoints accept either
-- (src/lib/nightly.ts cronAuthResult takes a list), so the GitHub workflows keep
-- working on the untouched CRON_SECRET.
--
-- tick_worker prefers cron_secret_db and falls back to cron_secret, so whichever
-- name exists in Vault is used, and it still does nothing at all while neither does.
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
