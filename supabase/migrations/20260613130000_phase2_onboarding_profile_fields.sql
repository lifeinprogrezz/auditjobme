-- Phase 2 onboarding: per-user job-search scoring inputs (spec §4). Additive, non-breaking.
-- Existing "Users can view/update/insert own profile" RLS already covers these columns.
-- Applied to roaervdsjejksaeseeov on 2026-06-13 (via MCP).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS target_seniority text,            -- apm | pm | senior | lead | founding
  ADD COLUMN IF NOT EXISTS target_cities text[],             -- e.g. {Barcelona, London, Berlin, Remote}
  ADD COLUMN IF NOT EXISTS open_to_remote boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS citizenship text,                 -- ISO-ish country, for work-auth scoring
  ADD COLUMN IF NOT EXISTS eu_work_authorized boolean,
  ADD COLUMN IF NOT EXISTS languages text[],                 -- e.g. {en, es}
  ADD COLUMN IF NOT EXISTS cv_text text,                     -- extracted from the uploaded CV
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;         -- null until onboarding is completed
