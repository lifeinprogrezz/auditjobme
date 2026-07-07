-- Phase B (overnight-job-hunter, spec 2026-07-07 §7): the per-user nightly
-- matches store. The nightly worker (api/nightly.ts, service-role) writes the
-- top-N scored roles for each active user; the in-app ready-to-apply view (a
-- later slice) reads them own-row. Additive, non-breaking.
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
CREATE TABLE IF NOT EXISTS public.daily_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_url text NOT NULL,                       -- jobs.url (the dedup + apply key)
  rank int,                                    -- 1-based, highest score first
  score numeric,                               -- blended 0-5 fit score
  reason text,                                 -- one-line "why it fits"
  fit_bullets jsonb,                           -- grounded "why you fit" points
  batch_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,                     -- set once the email fires (email idempotency)
  seen_at timestamptz,                         -- set when the user opens the in-app view (later slice)
  UNIQUE (user_id, job_url, batch_date)        -- one row per role per user per night → re-run is a no-op
);
ALTER TABLE public.daily_matches ENABLE ROW LEVEL SECURITY;

-- Own-row only. The nightly worker uses the service-role key (bypasses RLS) to
-- write; this policy governs the in-app read/manage path.
CREATE POLICY "Users manage own daily matches"
  ON public.daily_matches FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_daily_matches_user_batch
  ON public.daily_matches(user_id, batch_date);
