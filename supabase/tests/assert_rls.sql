-- F10 (Track D hardening batch, auditjobme#40): CI RLS gate.
-- Run with `psql -v ON_ERROR_STOP=1 -f` against a DB that has every migration in
-- supabase/migrations/ applied. Asserts:
--   1. Every public base table has row-level security ENABLED (no exceptions --
--      an RLS-disabled table is protected by GRANTs alone, which are broad by
--      default in this schema; see CLAUDE.md "RLS is the security model").
--   2. Every public base table has at least one policy, UNLESS it's in the
--      explicit deny-all allowlist below. RLS-enabled + zero policies is the
--      strictest posture (locked to service-role only) -- a deliberate choice
--      for whitelisted_emails (20260615120000_lock_usage_events_writes_and_
--      whitelist_pii.sql: "RLS-enabled with no policy = locked to everyone but
--      service-role"), not a gap. A NEW table landing here with zero policies
--      and no allowlist entry fails CI -- that is the drift this check exists
--      to catch.
do $$
declare
  no_rls text;
  no_policy text;
  -- Tables intentionally RLS-enabled with zero policies (deny-all, service-role-only).
  deny_all_allowlist text[] := array['whitelisted_emails'];
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into no_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if no_rls is not null then
    raise exception 'RLS not enabled on public table(s): %', no_rls;
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
    into no_policy
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> all (deny_all_allowlist)
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      );

  if no_policy is not null then
    raise exception 'No RLS policy on public table(s) -- add one, or add to deny_all_allowlist in this file if the lockdown is intentional: %', no_policy;
  end if;

  raise notice 'RLS check passed: RLS enabled on every public table; every table has a policy except the documented deny-all allowlist (%).', array_to_string(deny_all_allowlist, ', ');
end $$;

-- ---------------------------------------------------------------------------
-- status_events: the application-outcome ledger (auditjobme#77).
-- The generic block above only proves "RLS on, at least one policy". This table
-- needs a stricter shape pinned, because its whole value is that nobody can edit
-- it: own-row SELECT and nothing else, no client write privilege, and a trigger
-- that is the only writer. Losing any of those silently turns the ledger into
-- unusable outcome data, and there is no backfill.
do $$
declare
  bad text;
  n int;
  secdef boolean;
  cfg text[];
  tdef text;
  role_name text;
  priv text;
begin
  if to_regclass('public.status_events') is null then
    raise exception 'status_events is missing -- the outcome ledger (auditjobme#77) must exist';
  end if;

  -- 1. Own-row SELECT only. ANY other policy = a client-writable path.
  select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
    into bad
    from pg_policies
    where schemaname = 'public' and tablename = 'status_events' and cmd <> 'SELECT';
  if bad is not null then
    raise exception 'status_events must have SELECT-only policies (the trigger is the only writer); found: %', bad;
  end if;

  select count(*) into n
    from pg_policies
    where schemaname = 'public' and tablename = 'status_events'
      and cmd = 'SELECT' and qual like '%user_id%' and qual like '%uid%';
  if n <> 1 then
    raise exception 'status_events needs exactly one own-row (auth.uid() = user_id) SELECT policy; found %', n;
  end if;

  -- 2. No client write privilege either, so a future policy slip alone can't open one.
  foreach role_name in array array['authenticated', 'anon'] loop
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(role_name::name, 'public.status_events', priv) then
        raise exception 'role % still has % on status_events -- the ledger must be server-written only', role_name, priv;
      end if;
    end loop;
  end loop;

  -- 3. The writer runs past RLS on purpose, so it must be definer-rights with a
  --    locked search_path (an unlocked one is a privilege-escalation foothold).
  if to_regprocedure('public.log_application_status_event()') is null then
    raise exception 'the status_events trigger function log_application_status_event() is missing';
  end if;
  select p.prosecdef, p.proconfig into secdef, cfg
    from pg_proc p where p.oid = to_regprocedure('public.log_application_status_event()')::oid;
  if not secdef then
    raise exception 'log_application_status_event() must be SECURITY DEFINER -- it writes a table the caller cannot';
  end if;
  if cfg is null or not exists (select 1 from unnest(cfg) c where c like 'search_path=%') then
    raise exception 'log_application_status_event() must pin its search_path (SET search_path = ...)';
  end if;

  -- 4. Both triggers, with the shape the ledger depends on: the initial applied event
  --    on INSERT, and status moves only (no-op writes must not forge an event).
  select pg_get_triggerdef(t.oid) into tdef
    from pg_trigger t where t.tgrelid = 'public.applications'::regclass
      and t.tgname = 'applications_log_status_insert';
  if tdef is null then
    raise exception 'trigger applications_log_status_insert is missing on public.applications';
  end if;
  if tdef !~ 'AFTER INSERT ON public.applications' or tdef !~ 'FOR EACH ROW' then
    raise exception 'applications_log_status_insert must be AFTER INSERT ... FOR EACH ROW; got: %', tdef;
  end if;

  select pg_get_triggerdef(t.oid) into tdef
    from pg_trigger t where t.tgrelid = 'public.applications'::regclass
      and t.tgname = 'applications_log_status_update';
  if tdef is null then
    raise exception 'trigger applications_log_status_update is missing on public.applications';
  end if;
  if tdef !~ 'AFTER UPDATE OF status ON public.applications' then
    raise exception 'applications_log_status_update must fire AFTER UPDATE OF status; got: %', tdef;
  end if;
  if tdef !~ 'IS DISTINCT FROM' then
    raise exception 'applications_log_status_update needs its IS DISTINCT FROM guard so a no-op update writes no event; got: %', tdef;
  end if;

  raise notice 'status_events shape check passed: own-row SELECT only, no client writes, definer-rights trigger on insert + real status moves.';
end $$;

-- Behavioural pin for the same trigger: shape alone does not prove it records
-- anything. Seeds a throwaway user/job/application, walks a status move, and rolls
-- the whole thing back so the database is untouched.
begin;
do $$
declare
  uid uuid := gen_random_uuid();
  jid uuid;
  aid uuid;
  n int;
  ev public.status_events%rowtype;
begin
  insert into auth.users (id, email) values (uid, 'status-events-ci@example.invalid');
  insert into public.jobs (company, title, url)
    values ('CI Fixture', 'Product Manager', 'https://example.invalid/ci/status-events')
    returning id into jid;

  insert into public.applications (user_id, job_id, status)
    values (uid, jid, 'applied') returning id into aid;

  select count(*) into n from public.status_events where application_id = aid;
  if n <> 1 then
    raise exception 'creating an application must record its initial event; got % events', n;
  end if;
  select * into ev from public.status_events where application_id = aid;
  if ev.from_status is not null or ev.to_status <> 'applied' or ev.user_id <> uid then
    raise exception 'initial event is wrong: from=% to=% user=%', ev.from_status, ev.to_status, ev.user_id;
  end if;

  update public.applications set status = 'interview' where id = aid;
  select count(*) into n from public.status_events
    where application_id = aid and from_status = 'applied' and to_status = 'interview';
  if n <> 1 then
    raise exception 'the applied -> interview move was not recorded; got % matching events', n;
  end if;

  -- Writing the same status again, or touching an unrelated column, must add nothing.
  update public.applications set status = 'interview' where id = aid;
  update public.applications set notes = 'unrelated edit' where id = aid;
  select count(*) into n from public.status_events where application_id = aid;
  if n <> 2 then
    raise exception 'a no-op status write or an unrelated column edit forged an event; expected 2, got %', n;
  end if;

  raise notice 'status_events behaviour check passed: initial applied event + one real move recorded, no-op writes ignored.';
end $$;
rollback;
