-- Phase 2: per-user application tracker (spec §4 "applications"). Manual status transitions in v1.
-- Applied to roaervdsjejksaeseeov on 2026-06-13 (via MCP).
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'applied',   -- applied | responded | interview | offer | rejected
  applied_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (user_id, job_id)                  -- one tracked application per user x job
);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own applications"
  ON public.applications FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_applications_user ON public.applications(user_id);
