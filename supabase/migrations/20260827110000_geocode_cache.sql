-- Geocoding cache for scripts/geocode-companies.mjs (issue #153, item B2).
-- Nominatim (and Mapbox, when a key is configured) is rate-limited and its usage
-- policy expects results to be cached rather than re-fetched, so the SAME query
-- text -- a company+city address lookup, or a city-centroid lookup shared by
-- every company hiring in that city -- is asked at most once, ever. A row with
-- null lat/lng records a query that came back with no result, so a repeat run
-- does not keep re-asking for something that will never resolve.
--
-- Internal infrastructure for the service-role script only: the client reads
-- `company_offices` (the RESULT this cache feeds), never this table directly.
-- RLS enabled, zero policies -- deny-all to anon/authenticated, service role
-- bypasses RLS. Allowlisted in supabase/tests/assert_rls.sql alongside the
-- other intentional deny-all tables.
create table if not exists public.geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  precision text,
  fetched_at timestamptz not null default now()
);

comment on table public.geocode_cache is
  'Geocoder (Nominatim/Mapbox) results cached by the exact query text sent (issue #153). Null lat/lng = a query that returned no result. Service-role only; scripts/geocode-companies.mjs degrades gracefully (skips caching) if this table is absent.';

alter table public.geocode_cache enable row level security;
-- No policies on purpose -- see the table comment above.
