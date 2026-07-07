-- Phase A (overnight-job-hunter, spec 2026-07-07): CV-unlock front door.
-- Adds the label + cv-hash fields the CV-unlock modal writes at sign-in.
-- Additive, nullable, non-breaking. The existing own-row RLS on public.profiles
-- ("Users can view/update/insert own profile") already covers these columns, so
-- NO new policy is needed. Written but NOT auto-applied — apply to prod manually.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS target_roles text[],     -- function archetypes: Product, Growth, Data, ...
  ADD COLUMN IF NOT EXISTS target_sectors text[],   -- industries the user labelled (raw sector strings)
  ADD COLUMN IF NOT EXISTS cv_hash text;            -- deterministic hash of the trimmed CV (score-cache key)
