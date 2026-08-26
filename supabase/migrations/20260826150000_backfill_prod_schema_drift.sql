-- Issue #132: production held objects that no file in supabase/migrations/
-- described, so a database rebuilt from this directory (the CI "migrations + RLS
-- check") was narrower than the live one. This file reproduces the missing
-- objects, and adds the one function the new drift check reads.
--
-- Method (2026-08-26): production's public schema was dumped READ-ONLY through
-- the Supabase MCP (information_schema.columns, pg_constraint, pg_indexes,
-- pg_policies, pg_proc, pg_trigger, table grants, supabase_migrations.
-- schema_migrations) and compared object by object against the expected
-- result of every migration file, read in order. Docker was not available, so
-- the repo side was derived by reading, not by `supabase start`.
--
-- Every statement is guarded, so this is a no-op against production (where the
-- objects already exist) and a real backfill on a fresh stack.
--
-- Objects reproduced, and where each came from:
--
--   1. public.headcount_bucket_backup_20260726  (table; 598 rows in prod)
--      Ledger entry 20260726195946 headcount_bucket_backup_pre_vocabulary — the
--      pre-#68 snapshot of companies.headcount_bucket taken before
--      20260726101000_headcount_vocabulary.sql collapsed the two schemes into
--      one ladder. Live posture, copied exactly: RLS on, zero policies, grants
--      revoked from anon and authenticated (service role only). Company-keyed,
--      no personal data, so delete_own_account() does not need to know it.
--      Its rows are production data and are NOT seeded here.
--
--   2. public.companies.coord_city  (text, nullable)
--      Ledger entry 20260705200503 companies_coord_city, applied the same day as
--      20260705210000_dataplane_companies_dimension.sql but never mirrored into
--      that file. 200 live rows carry a value; src/integrations/supabase/types.ts
--      already declares it.
--
--   3. public.schema_snapshot()  (new — the guard for this issue)
--      Returns the public schema as one JSON document: tables, columns,
--      constraints, indexes, policies, functions, triggers, views. Read by
--      scripts/schema-drift-check.mjs and compared with the committed
--      supabase/schema-snapshot.json. Catalog metadata only; still locked to
--      the service role so policy predicates and function bodies are not a
--      public read.
--
-- Deliberately NOT here: the three ledger entries with no repo file of their
-- own (baseline_lovable_schema_import, link_jobs_to_companies_fn,
-- stale_refresh_pacing) — every object they created is already produced by an
-- existing migration file under a different name. Details in the PR for #132.

-- 1. headcount_bucket_backup_20260726 -------------------------------------------
create table if not exists public.headcount_bucket_backup_20260726 (
  slug text primary key,
  headcount_bucket text,
  captured_at timestamptz not null default now()
);

alter table public.headcount_bucket_backup_20260726 enable row level security;

-- Same reasoning as the two 20260819 backups: RLS with no policy blocks reads,
-- not writes made through the project's default table grant, which includes
-- DELETE and TRUNCATE. Revoke so no signed-in user can destroy the rollback path.
revoke all on public.headcount_bucket_backup_20260726 from anon, authenticated;

comment on table public.headcount_bucket_backup_20260726 is
  'Pre-#68 companies.headcount_bucket values, captured before 20260726101000_headcount_vocabulary.sql. Rollback source for that one-way rewrite; no policies, so only the service role reads it. Backfilled into the repo by #132.';

-- 2. companies.coord_city ---------------------------------------------------------
alter table public.companies
  add column if not exists coord_city text;

-- 3. schema_snapshot() ------------------------------------------------------------
-- Function bodies are compared by an md5 of the source with `--` comments and
-- ALL whitespace removed, lower-cased: production carries some functions as
-- re-applied compact copies of the same code (uppercase keywords, comments
-- stripped), and that formatting is not drift. A changed token is.
create or replace function public.schema_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', c.relname, 'kind', c.relkind::text, 'rls', c.relrowsecurity
      ) order by c.relname), '[]'::jsonb)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    ),
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name, 'name', column_name, 'type', data_type, 'udt', udt_name,
        'nullable', is_nullable = 'YES', 'default', column_default, 'generated', generation_expression
      ) order by table_name, column_name), '[]'::jsonb)
      from information_schema.columns
      where table_schema = 'public'
    ),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', c.relname, 'name', k.conname, 'def', pg_catalog.pg_get_constraintdef(k.oid)
      ) order by c.relname, k.conname), '[]'::jsonb)
      from pg_catalog.pg_constraint k
      join pg_catalog.pg_class c on c.oid = k.conrelid
      where k.connamespace = 'public'::regnamespace
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', indexname, 'def', indexdef
      ) order by tablename, indexname), '[]'::jsonb)
      from pg_catalog.pg_indexes
      where schemaname = 'public'
    ),
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', policyname, 'permissive', permissive, 'roles', roles::text,
        'cmd', cmd, 'qual', qual, 'with_check', with_check
      ) order by tablename, policyname), '[]'::jsonb)
      from pg_catalog.pg_policies
      where schemaname = 'public'
    ),
    'functions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', p.proname,
        'args', pg_catalog.pg_get_function_identity_arguments(p.oid),
        'returns', pg_catalog.pg_get_function_result(p.oid),
        'language', l.lanname,
        'security_definer', p.prosecdef,
        'config', p.proconfig,
        'body_md5', md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s', '', 'g')))
      ) order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_language l on l.oid = p.prolang
      where p.pronamespace = 'public'::regnamespace
        and p.proname <> 'schema_snapshot'
    ),
    'triggers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', c.relname, 'name', t.tgname, 'def', pg_catalog.pg_get_triggerdef(t.oid)
      ) order by c.relname, t.tgname), '[]'::jsonb)
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
    ),
    'views', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', viewname, 'def', definition
      ) order by viewname), '[]'::jsonb)
      from pg_catalog.pg_views
      where schemaname = 'public'
    )
  );
$$;

comment on function public.schema_snapshot() is
  'The public schema as one JSON document (tables, columns, constraints, indexes, policies, functions, triggers, views), for scripts/schema-drift-check.mjs to compare with supabase/schema-snapshot.json (issue #132). Service role only.';

revoke all on function public.schema_snapshot() from public, anon, authenticated;
grant execute on function public.schema_snapshot() to service_role;
