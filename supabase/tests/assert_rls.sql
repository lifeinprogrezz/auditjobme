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

  -- Un-applying must DETACH the history, never erase it (issue #77 follow-up, Rober
  -- 2026-07-26): application_id is nullable with ON DELETE SET NULL. Outcome data is
  -- never discarded, so a mis-click un-apply cannot take the ledger with it.
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.status_events'::regclass
      and attname = 'application_id' and attnotnull
  ) then
    raise exception 'status_events.application_id must be nullable so events survive un-applying';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.status_events'::regclass and contype = 'f'
      and conname = 'status_events_application_id_fkey' and confdeltype = 'n'
  ) then
    raise exception 'status_events.application_id foreign key must be ON DELETE SET NULL, never CASCADE';
  end if;

  raise notice 'status_events shape check passed: own-row SELECT only, no client writes, definer-rights trigger on insert + real status moves, history survives un-apply.';
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

  -- Un-applying the role (the mis-click correction in Apply.tsx deletes the application)
  -- must keep both events and simply detach them. The lookup moves to user_id, because
  -- application_id is exactly what gets nulled.
  delete from public.applications where id = aid;
  select count(*) into n from public.status_events where user_id = uid;
  if n <> 2 then
    raise exception 'deleting an application must PRESERVE its status events; expected 2, got %', n;
  end if;
  select count(*) into n from public.status_events where user_id = uid and application_id is not null;
  if n <> 0 then
    raise exception 'events of a deleted application must be detached (application_id null); % still attached', n;
  end if;

  raise notice 'status_events behaviour check passed: initial applied event + one real move recorded, no-op writes ignored, history survives un-apply.';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Account deletion reaches every table keyed to a user (auditjobme#84).
-- The product launches to European residents, so a delete request has to actually
-- empty the account. Three tables (device_fingerprints, feedback, purchases) carried
-- user_id with no foreign key at all until 20260726095000, which meant their rows
-- outlived the account silently. Shape first, behaviour second.
--
-- This is a DIFFERENT case from un-applying a single role, pinned above:
-- status_events.application_id stays ON DELETE SET NULL (history survives un-apply),
-- while status_events.user_id cascades (deleting the ACCOUNT removes the history).
-- Both pins live here on purpose so neither can be "fixed" into the other.
do $$
declare
  bad text;
  secdef boolean;
  cfg text[];
begin
  -- 1. Every column literally named user_id must be part of a foreign key to
  --    auth.users. A user_id with no constraint is the exact drift #84 found.
  select string_agg(format('%s.%s', c.relname, a.attname), ', ' order by c.relname)
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'user_id'
     and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_constraint k
        where k.conrelid = c.oid and k.contype = 'f'
          and k.confrelid = 'auth.users'::regclass
          and a.attnum = any (k.conkey)
      );
  if bad is not null then
    raise exception 'user_id column(s) with no foreign key to auth.users -- deleting the account would leave these rows behind: %', bad;
  end if;

  -- 2. Every foreign key from public into auth.users must be ON DELETE CASCADE.
  --    Covers profiles.id too (keyed by id, not user_id), and catches a future
  --    SET NULL / NO ACTION that would orphan rows instead of removing them.
  select string_agg(format('%s.%s', c.relname, k.conname), ', ' order by c.relname)
    into bad
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and k.contype = 'f'
      and k.confrelid = 'auth.users'::regclass
      and k.confdeltype <> 'c';
  if bad is not null then
    raise exception 'foreign key(s) to auth.users that are not ON DELETE CASCADE -- account deletion must remove every row keyed to the user: %', bad;
  end if;

  -- 3. The delete path itself: argument-free (so it can only remove the caller),
  --    definer-rights with a locked search_path, executable by signed-in users only.
  if to_regprocedure('public.delete_own_account()') is null then
    raise exception 'public.delete_own_account() is missing -- there is no way for a user to delete their account';
  end if;
  select p.prosecdef, p.proconfig into secdef, cfg
    from pg_proc p where p.oid = to_regprocedure('public.delete_own_account()')::oid;
  if not secdef then
    raise exception 'delete_own_account() must be SECURITY DEFINER -- a client has no privilege on auth.users';
  end if;
  if cfg is null or not exists (select 1 from unnest(cfg) c where c like 'search_path=%') then
    raise exception 'delete_own_account() must pin its search_path (SET search_path = ...)';
  end if;
  if not has_function_privilege('authenticated'::name, to_regprocedure('public.delete_own_account()')::oid, 'EXECUTE') then
    raise exception 'role authenticated must be able to EXECUTE delete_own_account()';
  end if;
  if has_function_privilege('anon'::name, to_regprocedure('public.delete_own_account()')::oid, 'EXECUTE') then
    raise exception 'role anon must NOT be able to EXECUTE delete_own_account() -- signed-in callers only';
  end if;

  raise notice 'account-deletion shape check passed: every user_id has a cascading foreign key to auth.users, every auth.users foreign key cascades, delete_own_account() is definer-rights and signed-in only.';
end $$;

-- Behavioural pin: shape alone does not prove the rows go. Seeds TWO throwaway users
-- with a row in every user-keyed table, deletes one of them through the real path
-- (delete_own_account(), called as that user), and asserts their rows are gone, the
-- other user's rows are untouched, and the shared job catalogue survives. The whole
-- thing rolls back so the database is unchanged.
begin;
do $$
declare
  mine uuid := gen_random_uuid();
  theirs uuid := gen_random_uuid();
  jid uuid;
  audit_mine uuid;
  audit_theirs uuid;
  -- Every table this check seeds and then asserts empty, as 'table.user_column'.
  seeded text[] := array[
    'applications.user_id', 'artifacts.user_id', 'audits.user_id',
    'company_requests.user_id', 'daily_matches.user_id', 'device_fingerprints.user_id',
    'dismissed_jobs.user_id', 'feedback.user_id', 'profiles.id', 'purchases.user_id',
    'saved_jobs.user_id', 'scores.user_id', 'status_events.user_id', 'usage_events.user_id'
  ];
  discovered text[];
  missing text;
  pair text;
  tbl text;
  col text;
  n int;
begin
  -- Drift guard: the seeded list must be EXACTLY the set of tables keyed to a user.
  -- A new user table that nobody added here would otherwise be "verified" by a check
  -- that never touches it.
  -- (the namespace alias is `ns`, not `n`: this block declares an `n` variable, and
  --  plpgsql resolves a qualified `n.x` against the variable, not the table)
  select array_agg(format('%s.%s', c.relname, a.attname) order by c.relname)
    into discovered
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
    where ns.nspname = 'public' and k.contype = 'f'
      and k.confrelid = 'auth.users'::regclass;

  select string_agg(x, ', ') into missing
    from (select unnest(discovered) except select unnest(seeded)) s(x);
  if missing is not null then
    raise exception 'table(s) keyed to auth.users that the deletion check never seeds -- add them to `seeded` in supabase/tests/assert_rls.sql: %', missing;
  end if;
  select string_agg(x, ', ') into missing
    from (select unnest(seeded) except select unnest(discovered)) s(x);
  if missing is not null then
    raise exception 'the deletion check seeds table(s) that no longer key to auth.users -- drop them from `seeded`: %', missing;
  end if;

  -- Seed both users. profiles rows are written by the on_auth_user_created trigger.
  insert into auth.users (id, email) values
    (mine, 'gdpr-delete-mine@example.invalid'),
    (theirs, 'gdpr-delete-theirs@example.invalid');
  update public.profiles set cv_text = 'CI fixture CV' where id in (mine, theirs);

  insert into public.jobs (company, title, url)
    values ('CI Fixture', 'Product Manager', 'https://example.invalid/ci/gdpr-delete')
    returning id into jid;

  -- applications also writes status_events, through the ledger trigger.
  insert into public.applications (user_id, job_id, status) values (mine, jid, 'applied');
  insert into public.applications (user_id, job_id, status) values (theirs, jid, 'applied');
  insert into public.saved_jobs (user_id, job_id) values (mine, jid), (theirs, jid);
  insert into public.dismissed_jobs (user_id, job_id) values (mine, jid), (theirs, jid);
  insert into public.scores (user_id, job_id, score) values (mine, jid, 4.2), (theirs, jid, 4.2);
  insert into public.artifacts (user_id, job_id, kind) values (mine, jid, 'cv'), (theirs, jid, 'cv');
  insert into public.audits (user_id, company_name, audit_data)
    values (mine, 'CI Fixture Co', '{}'::jsonb) returning id into audit_mine;
  insert into public.audits (user_id, company_name, audit_data)
    values (theirs, 'CI Fixture Co', '{}'::jsonb) returning id into audit_theirs;
  insert into public.company_requests (user_id, company_name) values (mine, 'CI Fixture Co'), (theirs, 'CI Fixture Co');
  insert into public.daily_matches (user_id, job_url)
    values (mine, 'https://example.invalid/ci/gdpr-delete'), (theirs, 'https://example.invalid/ci/gdpr-delete');
  insert into public.device_fingerprints (fingerprint_id, user_id, audit_id)
    values ('ci-fixture-fp', mine, audit_mine), ('ci-fixture-fp', theirs, audit_theirs);
  insert into public.feedback (user_id, message) values (mine, 'ci fixture'), (theirs, 'ci fixture');
  insert into public.purchases (user_id, stripe_session_id, credits, product_id)
    values (mine, 'ci-fixture-mine', 1, 'ci'), (theirs, 'ci-fixture-theirs', 1, 'ci');
  insert into public.usage_events (user_id, kind, cost_usd) values (mine, 'score', 0.001), (theirs, 'score', 0.001);

  -- Everything is really there before the delete, or the assertions below prove nothing.
  foreach pair in array seeded loop
    tbl := split_part(pair, '.', 1);
    col := split_part(pair, '.', 2);
    execute format('select count(*) from public.%I where %I = $1', tbl, col) into n using mine;
    if n < 1 then
      raise exception 'seeding failed: no % row for the user being deleted', tbl;
    end if;
  end loop;

  -- Delete through the real path, as the user themselves: a JWT claim so auth.uid()
  -- resolves, and the authenticated role so the privilege grants are exercised too.
  -- Both are transaction-local (set_config's third argument), and 'none' is the
  -- RESET ROLE equivalent.
  perform set_config('request.jwt.claims', json_build_object('sub', mine::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.delete_own_account();
  perform set_config('role', 'none', true);

  if exists (select 1 from auth.users where id = mine) then
    raise exception 'delete_own_account() left the auth.users row in place';
  end if;
  if not exists (select 1 from auth.users where id = theirs) then
    raise exception 'delete_own_account() removed somebody else -- it must only ever delete its caller';
  end if;

  foreach pair in array seeded loop
    tbl := split_part(pair, '.', 1);
    col := split_part(pair, '.', 2);
    execute format('select count(*) from public.%I where %I = $1', tbl, col) into n using mine;
    if n <> 0 then
      raise exception 'deleting the account left % row(s) in % -- the delete must reach every table keyed to the user', n, tbl;
    end if;
    execute format('select count(*) from public.%I where %I = $1', tbl, col) into n using theirs;
    if n < 1 then
      raise exception 'deleting one account emptied % for a different user', tbl;
    end if;
  end loop;

  -- The shared catalogue is not personal data and must survive.
  if not exists (select 1 from public.jobs where id = jid) then
    raise exception 'deleting an account removed a row from the shared jobs catalogue';
  end if;

  raise notice 'account-deletion behaviour check passed: delete_own_account() removed every row keyed to the caller across % tables, left the other account and the shared catalogue untouched.', array_length(seeded, 1);
end $$;
rollback;
