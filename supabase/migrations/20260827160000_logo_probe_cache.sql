-- Logo-domain probe cache for scripts/logo-backfill.mjs (issue #153, the
-- logo-coverage defect). The ATS-handle pass turns a company's apply-URL tenant
-- into candidate domains (1password -> 1password.com) and probes each one
-- before writing it, so a domain is only ever stored once a real site answers
-- on it. Most candidates fail, and without a memory every run would ask the
-- same dead domains again forever. This remembers each answer:
--   ok = true   the domain answered on itself; kept, never re-probed
--   ok = false  it did not; re-probed only after NEGATIVE_PROBE_TTL_DAYS
--               (30 days, scripts/logo-handle-lib.mjs), so a domain registered
--               later still gets a second chance.
--
-- Internal infrastructure for the service-role script only: the client reads
-- companies.logo_domain (the RESULT this cache feeds), never this table.
-- RLS enabled, zero policies -- deny-all to anon/authenticated, service role
-- bypasses RLS. Allowlisted in supabase/tests/assert_rls.sql alongside the
-- other intentional deny-all tables.
create table if not exists public.logo_probe_cache (
  domain text primary key,
  ok boolean not null,
  status integer,
  reason text,
  probed_at timestamptz not null default now()
);

comment on table public.logo_probe_cache is
  'Validation results for candidate logo domains derived from ATS handles (issue #153). ok=false is a remembered failure, re-probed after 30 days. Service-role only; scripts/logo-backfill.mjs degrades gracefully (skips caching) if this table is absent.';

alter table public.logo_probe_cache enable row level security;
-- No policies on purpose -- see the table comment above.
