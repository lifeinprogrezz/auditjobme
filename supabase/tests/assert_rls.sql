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
  -- Tables whose lockdown is INTENTIONAL: RLS on, no policy, so nothing but the
  -- service role can read them.
  --   whitelisted_emails         -- owner-only list, never user-facing
  --   *_backup_2026*             -- pre-migration snapshots. They hold the only
  --     record of what a row said before a one-way value rewrite, so they are the
  --     rollback path and must not be readable by the users they protect against.
  --     The migrations that create them also REVOKE the project's default
  --     anon/authenticated grants, because RLS without a policy blocks reads but
  --     not writes made through a table-level grant, and that default includes
  --     DELETE and TRUNCATE.
  --   geocode_cache               -- internal geocoder cache (issue #153); the
  --     client reads company_offices, the result this cache feeds, never the
  --     cache itself.
  --   logo_probe_cache            -- internal logo-domain probe results (issue
  --     #153); the client reads companies.logo_domain, the result this cache
  --     feeds, never the cache itself.
  deny_all_allowlist text[] := array[
    'whitelisted_emails',
    'headcount_bucket_backup_20260726',
    'companies_sector_backup_20260819',
    'profiles_targets_backup_20260819',
    'geocode_cache',
    'logo_probe_cache'
  ];
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

  -- 1b. Snapshot tables are invisible to the cascade. `create table as select` copies
  --     data but NOT constraints, so a backup has no foreign key and rule 1 above also
  --     misses it whenever its user column is not literally named user_id — which is
  --     exactly how profiles_targets_backup_20260819 kept deleted users' job targets
  --     (found 2026-08-19; its user column is `id`, copied from profiles).
  --     So: any *backup* table holding a uuid user key must be named explicitly in
  --     delete_own_account(). Company-keyed snapshots hold no personal data and pass.
  select string_agg(c.relname, ', ' order by c.relname)
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like '%backup%'
      and exists (
        select 1 from pg_attribute a join pg_type t on t.oid = a.atttypid
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          and a.attname in ('user_id', 'id') and t.typname = 'uuid'
      )
      and not exists (
        select 1 from pg_proc p
        where p.proname = 'delete_own_account' and p.prosrc like '%' || c.relname || '%'
      );
  if bad is not null then
    raise exception 'snapshot table(s) hold a user key but are not cleared by delete_own_account() -- erasure would leave the data behind: %', bad;
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
  -- Referral fixtures (issue #78): referrals carries TWO user columns, and a row
  -- linking mine<->theirs would cascade away with mine and falsely fail the
  -- "other user untouched" half. Two bystander accounts keep the pairs disjoint.
  bystander_a uuid := gen_random_uuid();
  bystander_b uuid := gen_random_uuid();
  jid uuid;
  audit_mine uuid;
  audit_theirs uuid;
  -- Every table this check seeds and then asserts empty, as 'table.user_column'.
  seeded text[] := array[
    'applications.user_id', 'artifacts.user_id', 'audits.user_id',
    'company_requests.user_id', 'connections.user_id', 'daily_matches.user_id', 'daily_top_sets.user_id',
    'device_fingerprints.user_id',
    'dismissed_jobs.user_id', 'feedback.user_id', 'inbound_emails.user_id',
    'inbound_tokens.user_id', 'profiles.id', 'purchases.user_id',
    'referral_tokens.user_id', 'referrals.referee_id', 'referrals.referrer_id',
    'saved_jobs.user_id', 'score_batches.user_id', 'scores.user_id', 'status_events.user_id',
    'usage_events.user_id'
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
    (theirs, 'gdpr-delete-theirs@example.invalid'),
    (bystander_a, 'gdpr-delete-bystander-a@example.invalid'),
    (bystander_b, 'gdpr-delete-bystander-b@example.invalid');
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
  -- connections: the user's own LinkedIn export rows (issue #41) must go with the account.
  insert into public.connections (user_id, full_name, company, company_key)
    values (mine, 'CI Fixture Person', 'CI Fixture Co', 'ci fixture co'),
           (theirs, 'CI Fixture Person', 'CI Fixture Co', 'ci fixture co');
  insert into public.daily_matches (user_id, job_url)
    values (mine, 'https://example.invalid/ci/gdpr-delete'), (theirs, 'https://example.invalid/ci/gdpr-delete');
  -- daily_top_sets (issue #155): the frozen "top matches" set for the day.
  insert into public.daily_top_sets (user_id, job_ids)
    values (mine, array[jid]), (theirs, array[jid]);
  insert into public.device_fingerprints (fingerprint_id, user_id, audit_id)
    values ('ci-fixture-fp', mine, audit_mine), ('ci-fixture-fp', theirs, audit_theirs);
  insert into public.feedback (user_id, message) values (mine, 'ci fixture'), (theirs, 'ci fixture');
  insert into public.purchases (user_id, stripe_session_id, credits, product_id)
    values (mine, 'ci-fixture-mine', 1, 'ci'), (theirs, 'ci-fixture-theirs', 1, 'ci');
  insert into public.usage_events (user_id, kind, cost_usd) values (mine, 'score', 0.001), (theirs, 'score', 0.001);
  -- score_batches carries an in-flight scoring job (issue #96); provider_batch_id is
  -- unique, so the two fixture rows need distinct ids.
  insert into public.score_batches (user_id, provider_batch_id, worker, rubric_version)
    values (mine, 'msgbatch_ci_fixture_mine', 'backlog', 'v6'),
           (theirs, 'msgbatch_ci_fixture_theirs', 'backlog', 'v6');
  -- Inbox forwarding (auditjobme#75): the token is unique, so distinct fixtures.
  insert into public.inbound_tokens (user_id, token)
    values (mine, 'cifixturetokenmine'), (theirs, 'cifixturetokentheirs');
  insert into public.inbound_emails (user_id, classification, action)
    values (mine, 'confirmation', 'confirmed'), (theirs, 'confirmation', 'confirmed');
  -- Referral attribution (auditjobme#78). Each of mine/theirs appears once as
  -- referrer and once as referee, always paired with a bystander: deleting mine
  -- must remove exactly the two rows mine is part of, and leave theirs' two rows
  -- (which involve no mine) standing.
  insert into public.referral_tokens (user_id, token)
    values (mine, 'cifixturereftokmine'), (theirs, 'cifixturereftoktheirs');
  insert into public.referrals (referrer_id, referee_id)
    values (mine, bystander_a), (bystander_a, mine),
           (theirs, bystander_b), (bystander_b, theirs);

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

-- ---------------------------------------------------------------------------
-- Audits start private (auditjobme#90). AuditGenerator used to hard-code
-- is_published: true on every insert, so every audit -- naming a real company,
-- carrying the author's public display name -- was readable by anyone holding
-- the link the moment it was generated, with no action from the user. The
-- fix: the column default (false, since 20260613120000_private_by_default.sql)
-- now actually holds, and publishing is a separate, owner-only action.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  aid uuid;
  aid2 uuid;
  n int;
begin
  insert into auth.users (id, email) values
    (owner_id, 'audit-owner-90-ci@example.invalid'),
    (other_id, 'audit-other-90-ci@example.invalid');

  -- The owner creates an audit exactly as AuditGenerator now does: no
  -- is_published given, so it must land on the column default.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.audits (user_id, company_name, audit_data, slug)
    values (owner_id, 'CI Fixture Co', '{}'::jsonb, 'ci-fixture-audit-90')
    returning id into aid;

  select count(*) into n from public.audits where id = aid and is_published = false;
  if n <> 1 then
    raise exception 'a newly inserted audit with no explicit is_published must default to private (false)';
  end if;

  -- The owner must still be able to read their own unpublished audit.
  select count(*) into n from public.audits where id = aid;
  if n <> 1 then
    raise exception 'the owner must be able to read their own unpublished audit';
  end if;

  -- As anon, the unpublished audit is invisible -- the exact link-exposure bug
  -- this issue closes.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.audits where id = aid;
  if n <> 0 then
    raise exception 'an unpublished audit must not be readable by anon -- found % row(s)', n;
  end if;

  -- A different signed-in user must not be able to publish somebody else's audit.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id::text)::text, true);
  update public.audits set is_published = true where id = aid;
  select count(*) into n from public.audits where id = aid and is_published = true;
  if n <> 0 then
    raise exception 'a different user must not be able to publish somebody else''s audit';
  end if;

  -- The owner publishes it -- the explicit share action (AuditGenerator's
  -- "Publish & Get Link" control), which depends on the owner-scoped UPDATE
  -- policy added alongside this fix.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id::text)::text, true);
  update public.audits set is_published = true where id = aid;
  select count(*) into n from public.audits where id = aid and is_published = true;
  if n <> 1 then
    raise exception 'the owner must be able to publish (UPDATE is_published) their own audit';
  end if;

  -- Now, and only now, anon can read it.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.audits where id = aid and is_published = true;
  if n <> 1 then
    raise exception 'a published audit must be readable by anon -- the whole point of the share link';
  end if;

  -- A different SIGNED-IN user must also be able to read the published audit --
  -- the acceptance-panel fix (2026-07-26). Before it, "Anyone can view
  -- published audits" was TO anon only, so a signed-in visitor following the
  -- exact same /a/:username/:slug share link (issue #82) got zero rows while
  -- an anonymous visitor did not -- the asymmetry that let this ship unnoticed.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id::text)::text, true);
  select count(*) into n from public.audits where id = aid and is_published = true;
  if n <> 1 then
    raise exception 'a published audit must be readable by a DIFFERENT signed-in user, not just anon';
  end if;

  -- Regression guard: the fix must not become "every audit is visible to
  -- everyone". A second, still-private audit from the SAME owner must stay
  -- invisible to that other signed-in user -- only is_published = true opens
  -- the door, and #90's private-by-default guarantee must survive this change.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id::text)::text, true);
  insert into public.audits (user_id, company_name, audit_data, slug)
    values (owner_id, 'CI Fixture Co', '{}'::jsonb, 'ci-fixture-audit-90-unpub')
    returning id into aid2;

  perform set_config('request.jwt.claims', json_build_object('sub', other_id::text)::text, true);
  select count(*) into n from public.audits where id = aid2;
  if n <> 0 then
    raise exception 'an unpublished audit must still be invisible to a different signed-in user -- found % row(s)', n;
  end if;

  perform set_config('role', 'none', true);
  raise notice 'audit privacy check passed: private by default, invisible to anon until published, only the owner can publish, published audits are readable by anon AND by a different signed-in user, unpublished audits stay invisible to both.';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Inbox forwarding (auditjobme#75): per-user forwarding tokens + the inbound
-- parse ledger + applications.confirmed_at. Shape first: both tables are
-- server-written only (own-row SELECT, zero client write privilege), the token
-- RPC is definer-rights with a pinned search_path, and the confirmed_at guard
-- trigger is in place. confirmed_at is what the referral qualifying event (#78)
-- will pay out on, so a client-stampable path here is a fraud path.
do $$
declare
  bad text;
  n int;
  secdef boolean;
  cfg text[];
  tbl text;
  role_name text;
  priv text;
begin
  foreach tbl in array array['inbound_tokens', 'inbound_emails'] loop
    if to_regclass('public.' || tbl) is null then
      raise exception '% is missing -- the inbox-forwarding path (auditjobme#75) must exist', tbl;
    end if;

    select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
      into bad
      from pg_policies
      where schemaname = 'public' and tablename = tbl and cmd <> 'SELECT';
    if bad is not null then
      raise exception '% must have SELECT-only policies (server-role writes only); found: %', tbl, bad;
    end if;

    select count(*) into n
      from pg_policies
      where schemaname = 'public' and tablename = tbl
        and cmd = 'SELECT' and qual like '%user_id%' and qual like '%uid%';
    if n <> 1 then
      raise exception '% needs exactly one own-row (auth.uid() = user_id) SELECT policy; found %', tbl, n;
    end if;

    foreach role_name in array array['authenticated', 'anon'] loop
      foreach priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name::name, 'public.' || tbl, priv) then
          raise exception 'role % still has % on % -- inbox rows must be server-written only', role_name, priv, tbl;
        end if;
      end loop;
    end loop;
  end loop;

  -- Token creation RPC: definer-rights (clients have no INSERT), pinned search_path,
  -- callable by authenticated only -- anon must never mint a token.
  if to_regprocedure('public.get_or_create_forwarding_token()') is null then
    raise exception 'get_or_create_forwarding_token() is missing';
  end if;
  select p.prosecdef, p.proconfig into secdef, cfg
    from pg_proc p where p.oid = to_regprocedure('public.get_or_create_forwarding_token()')::oid;
  if not secdef then
    raise exception 'get_or_create_forwarding_token() must be SECURITY DEFINER -- it writes a table the caller cannot';
  end if;
  if cfg is null or not exists (select 1 from unnest(cfg) c where c like 'search_path=%') then
    raise exception 'get_or_create_forwarding_token() must pin its search_path (SET search_path = ...)';
  end if;
  if has_function_privilege('anon', 'public.get_or_create_forwarding_token()', 'EXECUTE') then
    raise exception 'anon must not be able to execute get_or_create_forwarding_token()';
  end if;
  if not has_function_privilege('authenticated', 'public.get_or_create_forwarding_token()', 'EXECUTE') then
    raise exception 'authenticated must be able to execute get_or_create_forwarding_token() -- Settings creates the address with it';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.applications'::regclass
      and t.tgname = 'applications_protect_confirmed_at'
  ) then
    raise exception 'trigger applications_protect_confirmed_at is missing -- confirmed_at would be client-stampable (the #78 fraud path)';
  end if;

  raise notice 'inbox-forwarding shape check passed: server-written tables, own-row SELECT only, definer-rights token RPC, confirmed_at guard trigger present.';
end $$;

-- Behavioural pin: a signed-in client must NOT be able to stamp confirmed_at (their
-- ordinary edits still work); the server path (no JWT) must. And the token RPC must
-- mint once and then return the same token forever. All rolled back.
begin;
do $$
declare
  uid uuid := gen_random_uuid();
  jid uuid;
  aid uuid;
  ts timestamptz;
  tok1 text;
  tok2 text;
begin
  insert into auth.users (id, email) values (uid, 'inbox-forwarding-ci@example.invalid');
  insert into public.jobs (company, title, url)
    values ('CI Fixture', 'Product Manager', 'https://example.invalid/ci/inbox-forwarding')
    returning id into jid;
  insert into public.applications (user_id, job_id, status)
    values (uid, jid, 'applied') returning id into aid;

  -- Client context = a JWT present, so auth.uid() resolves (that is the exact test
  -- the guard trigger makes). The role stays the harness role on purpose: table
  -- grants for authenticated aren't what this block pins, and the ephemeral CI DB
  -- doesn't carry the hosted stack's default-privilege grants on applications.
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text)::text, true);
  update public.applications set confirmed_at = now(), notes = 'client edit' where id = aid;
  select confirmed_at into ts from public.applications where id = aid;
  if ts is not null then
    raise exception 'a signed-in client stamped their own confirmed_at -- the #78 qualifying event is forgeable';
  end if;

  -- The token RPC works for the signed-in user and is idempotent.
  select public.get_or_create_forwarding_token() into tok1;
  select public.get_or_create_forwarding_token() into tok2;
  if tok1 is null or length(tok1) < 16 then
    raise exception 'get_or_create_forwarding_token() returned a weak or empty token: %', tok1;
  end if;
  if tok1 <> tok2 then
    raise exception 'get_or_create_forwarding_token() must return the SAME token on every call; got % then %', tok1, tok2;
  end if;

  -- Server context (no JWT): the inbound endpoint's write sticks.
  perform set_config('request.jwt.claims', '', true);
  update public.applications set confirmed_at = now() where id = aid;
  select confirmed_at into ts from public.applications where id = aid;
  if ts is null then
    raise exception 'the server-side confirmed_at write was blocked -- the guard trigger is too broad';
  end if;

  raise notice 'inbox-forwarding behaviour check passed: client cannot stamp confirmed_at, server can, token RPC is idempotent.';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Referral attribution (auditjobme#78, attribution half only — the reward half
-- is blocked on #35). referrals is the fraud surface a future reward pays out
-- against, so its write path must stay exactly this narrow: zero client write
-- privilege on both tables, the definer-rights RPCs as the only writers, and the
-- claim deriving referrer/referee/signed_up_at entirely server-side. Shape first.
do $$
declare
  bad text;
  n int;
  secdef boolean;
  cfg text[];
  tbl text;
  role_name text;
  priv text;
  fn text;
begin
  foreach tbl in array array['referral_tokens', 'referrals'] loop
    if to_regclass('public.' || tbl) is null then
      raise exception '% is missing -- referral attribution (auditjobme#78) must exist', tbl;
    end if;

    select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
      into bad
      from pg_policies
      where schemaname = 'public' and tablename = tbl and cmd <> 'SELECT';
    if bad is not null then
      raise exception '% must have SELECT-only policies (server-side RPCs are the only writers); found: %', tbl, bad;
    end if;

    foreach role_name in array array['authenticated', 'anon'] loop
      foreach priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name::name, 'public.' || tbl, priv) then
          raise exception 'role % still has % on % -- referral rows must be server-written only', role_name, priv, tbl;
        end if;
      end loop;
    end loop;
  end loop;

  -- referral_tokens: exactly one own-row SELECT policy.
  select count(*) into n
    from pg_policies
    where schemaname = 'public' and tablename = 'referral_tokens'
      and cmd = 'SELECT' and qual like '%user_id%' and qual like '%uid%';
  if n <> 1 then
    raise exception 'referral_tokens needs exactly one own-row (auth.uid() = user_id) SELECT policy; found %', n;
  end if;

  -- referrals: exactly one SELECT policy, scoped to BOTH parties of the row.
  select count(*) into n
    from pg_policies
    where schemaname = 'public' and tablename = 'referrals'
      and cmd = 'SELECT'
      and qual like '%referrer_id%' and qual like '%referee_id%' and qual like '%uid%';
  if n <> 1 then
    raise exception 'referrals needs exactly one party-scoped (auth.uid() = referrer_id OR referee_id) SELECT policy; found %', n;
  end if;

  -- One referrer per referee, forever: the PRIMARY KEY must be referee_id.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass and contype = 'p'
      and conkey = (select array_agg(attnum) from pg_attribute
                    where attrelid = 'public.referrals'::regclass and attname = 'referee_id')
  ) then
    raise exception 'referrals must have its PRIMARY KEY on referee_id -- one referrer per referee is the anti-fraud shape';
  end if;

  -- Self-referral is refused in the schema, not just in the RPC.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'referrer_id\s*<>\s*referee_id'
  ) then
    raise exception 'referrals is missing its CHECK (referrer_id <> referee_id) self-referral guard';
  end if;

  -- Both RPCs: definer-rights (clients hold no write privilege), pinned
  -- search_path, callable by authenticated only -- anon can neither mint nor claim.
  foreach fn in array array['public.get_or_create_referral_token()', 'public.claim_referral(text)'] loop
    if to_regprocedure(fn) is null then
      raise exception '% is missing', fn;
    end if;
    select p.prosecdef, p.proconfig into secdef, cfg
      from pg_proc p where p.oid = to_regprocedure(fn)::oid;
    if not secdef then
      raise exception '% must be SECURITY DEFINER -- it writes a table the caller cannot', fn;
    end if;
    if cfg is null or not exists (select 1 from unnest(cfg) c where c like 'search_path=%') then
      raise exception '% must pin its search_path (SET search_path = ...)', fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(fn)::oid, 'EXECUTE') then
      raise exception 'anon must not be able to execute %', fn;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure(fn)::oid, 'EXECUTE') then
      raise exception 'authenticated must be able to execute %', fn;
    end if;
  end loop;

  raise notice 'referral shape check passed: server-written tables, party-scoped SELECT only, referee_id primary key, self-referral CHECK, definer-rights RPCs for authenticated only.';
end $$;

-- Behavioural pin: the token RPC mints once; the claim records exactly the caller
-- with the token's owner as referrer; unknown tokens, self-referrals, second
-- claims and stale accounts are all refused. All rolled back.
begin;
do $$
declare
  referrer uuid := gen_random_uuid();
  referee uuid := gen_random_uuid();
  latecomer uuid := gen_random_uuid();
  tok1 text;
  tok2 text;
  ok boolean;
  n int;
  r record;
begin
  -- created_at is seeded explicitly: GoTrue stamps it in production, but a bare
  -- INSERT here leaves it NULL, and claim_referral fails closed on a NULL
  -- created_at (an account whose age cannot be proven is never attributed).
  insert into auth.users (id, email, created_at) values
    (referrer, 'referral-referrer-ci@example.invalid', now()),
    (referee, 'referral-referee-ci@example.invalid', now()),
    -- An account past the sign-up window: created 30 days ago.
    (latecomer, 'referral-latecomer-ci@example.invalid', now() - interval '30 days');

  -- The referrer mints a token; the RPC is idempotent.
  perform set_config('request.jwt.claims', json_build_object('sub', referrer::text)::text, true);
  select public.get_or_create_referral_token() into tok1;
  select public.get_or_create_referral_token() into tok2;
  if tok1 is null or length(tok1) < 16 then
    raise exception 'get_or_create_referral_token() returned a weak or empty token: %', tok1;
  end if;
  if tok1 <> tok2 then
    raise exception 'get_or_create_referral_token() must return the SAME token on every call; got % then %', tok1, tok2;
  end if;

  -- Self-referral: the referrer claiming their own token is refused.
  select public.claim_referral(tok1) into ok;
  if ok then
    raise exception 'claim_referral() accepted a self-referral';
  end if;

  -- A fresh referee claims: recorded, with the referrer derived from the token
  -- and signed_up_at from the account creation, never from the client.
  perform set_config('request.jwt.claims', json_build_object('sub', referee::text)::text, true);
  select public.claim_referral('not-a-real-token') into ok;
  if ok then
    raise exception 'claim_referral() accepted an unknown token';
  end if;
  select public.claim_referral(tok1) into ok;
  if not ok then
    raise exception 'claim_referral() refused a valid first claim from a fresh account';
  end if;
  select * into r from public.referrals where referee_id = referee;
  if r is null or r.referrer_id <> referrer or r.signed_up_at is null then
    raise exception 'the attribution row is wrong: referrer=% signed_up_at=%', r.referrer_id, r.signed_up_at;
  end if;

  -- Claiming again -- same token or anyone else's -- must change nothing.
  select public.claim_referral(tok1) into ok;
  if ok then
    raise exception 'a second claim by the same referee must be a no-op';
  end if;
  select count(*) into n from public.referrals where referee_id = referee;
  if n <> 1 then
    raise exception 'the referee must have exactly one attribution row; found %', n;
  end if;

  -- An established account (past the window) is never rewritten into a referral.
  perform set_config('request.jwt.claims', json_build_object('sub', latecomer::text)::text, true);
  select public.claim_referral(tok1) into ok;
  if ok then
    raise exception 'claim_referral() attributed an account created outside the sign-up window';
  end if;
  select count(*) into n from public.referrals where referee_id = latecomer;
  if n <> 0 then
    raise exception 'a stale account acquired an attribution row';
  end if;

  raise notice 'referral behaviour check passed: idempotent token mint, valid first claim recorded with server-derived fields, unknown token / self-referral / repeat claim / stale account all refused.';
end $$;
rollback;
