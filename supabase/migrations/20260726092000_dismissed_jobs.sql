-- Issue #73 slice 4: per-user "not interested" roles. The product had no way to say
-- no to a role, so the same rejected match kept nagging from the top of the queue.
-- A dismissed role drops out of the Today action queue AND the map rail, and is
-- undoable from the Dismissed list in /settings.
--
-- Deliberately a SEPARATE table from applications (a dismissal is not an application
-- stage) and an exact structural mirror of saved_jobs: same own-row RLS policy, same
-- unique (user_id, job_id) so a repeat dismiss is a no-op, same user index.
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
CREATE TABLE IF NOT EXISTS public.dismissed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)                  -- one dismissal per user x job
);
ALTER TABLE public.dismissed_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own dismissed jobs"
  ON public.dismissed_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_dismissed_jobs_user ON public.dismissed_jobs(user_id);
