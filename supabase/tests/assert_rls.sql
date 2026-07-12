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
