-- Company context for the /roles detail panel (Rober 2026-07-06).
-- The panel already renders sector, stage, headcount_bucket, hq_city/country,
-- website and linkedin_url (all pre-existing on companies). Two fields were
-- missing and are added here, both nullable + additive (non-destructive):
--   description  — one-line "what they do", GROUNDED: a Haiku pass over the
--                  company's jd_text, or the site's og:description; null when
--                  neither is available (never fabricated).
--   founded_year — founding year from Wikidata; sparse for small startups → null ok.
-- companies already grants anon SELECT, so these columns are readable with no
-- policy change. Rollback: drop the two columns.
alter table public.companies
  add column if not exists description text,
  add column if not exists founded_year integer;

comment on column public.companies.description is
  'One-line company summary for the /roles detail panel; grounded (JD or og:description), nullable, never fabricated.';
comment on column public.companies.founded_year is
  'Founding year (Wikidata); nullable — sparse for small startups.';
