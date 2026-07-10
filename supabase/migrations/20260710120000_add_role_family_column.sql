-- Role vertical seam for the all-vertical milestone (issue #34). Additive +
-- nullable, following 20260709150000_jd_extraction_columns.sql. Nothing writes
-- it yet: null = pre-all-vertical row, and the client maps null → "Product
-- Manager" while the pipeline is PM-gated. Deliberately NO default — a
-- 'Product Manager' default would silently mislabel non-PM rows the moment
-- all-vertical scraping starts.
-- Spec: planning repo docs/specs/2026-07-10-headbar-role-facet-design.md
alter table public.jobs add column if not exists role_family text;

comment on column public.jobs.role_family is
  'Role vertical (e.g. Product Manager, Data, Design). Null = pre-all-vertical row; the client maps null to Product Manager while the pipeline is PM-gated. Written by the extractor/scrapers from the all-vertical milestone on (issue #34).';
