-- Phase 2 data plane (spec §4): shared job pool + per-user scores.
-- Applied to roaervdsjejksaeseeov on 2026-06-13 (via MCP).

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  title text NOT NULL,
  url text NOT NULL UNIQUE,                 -- canonical apply URL (dedup key)
  location text,
  remote boolean NOT NULL DEFAULT false,
  source text,                              -- scraper/channel (greenhouse, lever, seed, ...)
  posted_at timestamptz,
  jd_text text,                             -- description body, for scoring
  seniority text,                           -- inferred level (apm|pm|senior|lead|founding)
  is_live boolean NOT NULL DEFAULT true,    -- liveness flag (dead URLs flipped false)
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
-- Shared pool: any signed-in user reads live jobs. Writes are by the scrape job only
-- (service-role, which bypasses RLS) — no user-facing write policy on purpose.
CREATE POLICY "Authenticated can read live jobs"
  ON public.jobs FOR SELECT TO authenticated USING (is_live = true);
CREATE INDEX idx_jobs_live ON public.jobs(is_live);

CREATE TABLE public.scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  score numeric,                            -- blended 0-5 (digest sort key)
  rubric_version text NOT NULL DEFAULT 'v1',
  signals jsonb,                            -- LLM signal breakdown
  scored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id, rubric_version)  -- cache key
);
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scores"
  ON public.scores FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_scores_user ON public.scores(user_id);
