-- JD structured-data extraction: additive, nullable role-level fact columns on jobs.
-- Fail-open: every field nullable, null = eligible/show. No RLS change (anon SELECT on
-- is_live already covers new columns). Rollback = drop columns.
-- Spec: planning repo docs/specs/2026-07-09-jd-data-extraction-design.md
alter table public.jobs
  add column if not exists extraction jsonb,
  add column if not exists extraction_version text,
  add column if not exists jd_hash text,
  add column if not exists extracted_at timestamptz,
  add column if not exists jd_source_detail text;

comment on column public.jobs.extraction is 'Role-level structured facts extracted from jd_text (JSONB; every field nullable; null = eligible/show). Written by scripts/extract-jd.mjs.';
comment on column public.jobs.extraction_version is 'EXTRACTION_VERSION the row was extracted under; mismatch triggers re-extract.';
comment on column public.jobs.jd_hash is 'djb2 hash of jd_text at extraction time; a change triggers re-extract.';
comment on column public.jobs.extracted_at is 'Timestamp of the last extraction run for this row.';
comment on column public.jobs.jd_source_detail is 'Which backfill path filled jd_text (observability; scripts/jd-backfill.mjs).';
