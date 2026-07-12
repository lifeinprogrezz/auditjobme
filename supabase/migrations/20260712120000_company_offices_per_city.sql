-- F5 (Track D hardening batch, auditjobme#40): company_offices went live via MCP
-- apply_migration on 2026-07-05 (remote migration history: 20260705221926
-- company_offices_per_city) but the file was never committed to
-- supabase/migrations/ -- a live table outside version control. Backfilling it here.
-- Per-city office coords for a company (the map snaps a role to the nearest office
-- within a city instead of the single companies.lat/lng centroid) — read by
-- src/hooks/useRolesData.ts and scripts/build-dataplane.mjs.
--
-- Live schema + RLS posture captured read-only via the Supabase MCP
-- (information_schema.columns, pg_constraint, pg_indexes, pg_policies) on 2026-07-12
-- against roaervdsjejksaeseeov: RLS was already enabled with a public-read policy
-- (mirrors the companies table, no gap found) -- this migration reproduces that exact
-- state so it is a no-op when applied against the already-live prod DB.
-- Spec: planning repo docs/specs/2026-07-09-audit-D-remediation-plan.md (F5).
create table if not exists public.company_offices (
  company_slug text not null references public.companies(slug) on delete cascade,
  city_key text not null,
  city text,
  address text,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now(),
  primary key (company_slug, city_key)
);

comment on table public.company_offices is
  'Per-city office coordinates for a company. A company with roles in several cities gets one row per city; the map matches a role to the nearest office within its city, falling back to companies.lat/lng when a city has no row here.';

alter table public.company_offices enable row level security;

-- Anon + authenticated read everything (public job map); no write policies on
-- purpose -- writes are service-role only, same as companies/jobs.
drop policy if exists "Anyone can read company_offices" on public.company_offices;
create policy "Anyone can read company_offices" on public.company_offices
  for select to anon, authenticated using (true);
