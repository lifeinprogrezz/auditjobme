-- Issue #96 lever 2: move the non-interactive scoring workers onto the Anthropic
-- Message Batches path (a flat 50% discount on input AND output). Batch work is
-- asynchronous and outlives the 60s function invocation that submitted it, so the
-- in-flight state has to live in the database rather than in the worker's memory.
--
-- score_batches is that state. One row per submitted batch, one batch per user per
-- worker pass. job_ids is the in-flight set: the backlog predicate subtracts it so a
-- later tick never re-submits (and never re-pays for) a role already sitting in an
-- open batch. custom_id on each batch request is the job id, which is how a returned
-- result is mapped back to a row.
--
-- usage_events.batch is the metering split. Cost stays measurable per kind and per
-- user exactly as before (kind stays 'score'); the new column is what lets the
-- economics work separate full-price interactive scoring from discounted batch
-- scoring instead of averaging the two into one misleading number.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.

CREATE TABLE IF NOT EXISTS public.score_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_batch_id text NOT NULL UNIQUE,   -- Anthropic's msgbatch_… id
  worker text NOT NULL CHECK (worker IN ('backlog', 'nightly')),
  rubric_version text NOT NULL,             -- results are discarded on a rubric bump
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'retrieved', 'failed')),
  job_ids uuid[] NOT NULL DEFAULT '{}',     -- the in-flight set (bounded per batch)
  batch_date date,                          -- nightly only: which daily_matches day
  submitted_at timestamptz NOT NULL DEFAULT now(),
  retrieved_at timestamptz
);

ALTER TABLE public.score_batches ENABLE ROW LEVEL SECURITY;

-- Read-own only. Every write is service-role (the workers + the proxy), which
-- bypasses RLS; clients must never be able to forge or retire a batch row.
CREATE POLICY "Users read own score batches"
  ON public.score_batches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.score_batches FROM authenticated, anon;

-- The hot lookup: "open batches for this user", run once per user per tick.
CREATE INDEX IF NOT EXISTS idx_score_batches_open
  ON public.score_batches (user_id, status);

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS batch boolean NOT NULL DEFAULT false;
