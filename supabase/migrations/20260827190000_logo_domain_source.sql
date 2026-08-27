-- Provenance for companies.logo_domain (issue #153, the logo-coverage defect,
-- round 5). Until now the column said WHAT the domain was and nothing about HOW
-- it was obtained, and scripts/logo-backfill.mjs scans `logo_domain is null`.
-- Together those made a wrong value PERMANENT: a guessed domain dropped out of
-- every future sweep and could not be told apart from a good one.
--
-- Four values, checked, so a wrong-by-construction row can be found and fixed:
--   'board'        the ATS board that the apply URL names published this website
--                  (Ashby organization.publicWebsite, Workable account url, ...).
--                  A fact the company itself put on its own board.
--   'company_url'  derived from the careers_url / website already on the row
--                  (scripts/logo-lib.mjs). Also a fact.
--   'guess'        BUILT from the ATS tenant handle and then probed
--                  (scripts/logo-handle-lib.mjs). The only value the backfill is
--                  allowed to REVISIT and overwrite, because it is the only one
--                  that was never published by anybody.
--   'manual'       set by hand. Never overwritten.
--
-- No backfill of existing rows: nothing recorded how they were obtained, and
-- inventing a provenance for 639 live rows would defeat the point of the column.
-- They stay NULL, which reads as "unknown, do not touch" — the backfill only
-- revisits an explicit 'guess'.
--
-- No RLS change: this is a column on `companies`, which already has its own
-- policies (public read of the map dimension), so supabase/tests/assert_rls.sql
-- needs no new allowlist entry — that gate governs TABLES.
alter table public.companies
  add column if not exists logo_domain_source text;

alter table public.companies
  drop constraint if exists companies_logo_domain_source_vocabulary;

alter table public.companies
  add constraint companies_logo_domain_source_vocabulary
  check (
    logo_domain_source is null
    or logo_domain_source = any (array['board','company_url','guess','manual'])
  );

comment on column public.companies.logo_domain_source is
  'How logo_domain was obtained: board (published by the ATS board), company_url (derived from careers_url/website on file), guess (built from the ATS handle and probed — the only source scripts/logo-backfill.mjs may overwrite), manual (set by hand). NULL means it predates this column.';

create index if not exists companies_logo_domain_source_idx
  on public.companies (logo_domain_source)
  where logo_domain_source is not null;
