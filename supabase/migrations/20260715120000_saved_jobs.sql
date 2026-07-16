-- Phase 2: per-user saved / bookmarked roles (Rober 2026-07-15). A "save for later"
-- so people don't have to prep an application in the same sitting. Deliberately a
-- SEPARATE table from applications, not a 6th tracker status, so a saved (pre-apply)
-- role never lands on the Applied kanban. Mirrors the applications RLS pattern exactly.
-- Applied to roaervdsjejksaeseeov on 2026-07-15 (via MCP).
CREATE TABLE public.saved_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)                  -- one bookmark per user x job
);
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own saved jobs"
  ON public.saved_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_saved_jobs_user ON public.saved_jobs(user_id);
