-- Issue #155 (spec 2026-08-26-stranger-run-feedback-answers.md item C1, decision 2):
-- freeze "Your top matches" to a fixed set of 10 per user per UTC day. Today.tsx's
-- action queue re-ranks live on every apply/dismiss, so the row that used to be #11
-- always hopped up into the visible ten — nothing ever felt finished. This table is
-- the freeze: the first time a user's Today render computes a top-10 on a given UTC
-- day, those ids are written here once and read back for every later visit that same
-- day, so applying or dismissing marks a slot done in place instead of refilling it.
--
-- Client-written (not the nightly worker): the freeze has to happen the moment a real
-- browser first computes that day's top 10, so this is an own-row SELECT + INSERT
-- policy, not the read-only-plus-service-role shape daily_matches uses. No UPDATE
-- policy: a frozen set is immutable for the rest of its day by design — "done" is
-- derived at read time from applications/dismissed_jobs, never written back here.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
-- The app degrades to a localStorage fallback (keyed user id + day) when this table
-- is absent, so the feature works before and after the migration lands.

CREATE TABLE IF NOT EXISTS public.daily_top_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT current_date,
  job_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)   -- one frozen set per user per day; a second freeze is a no-op
);

ALTER TABLE public.daily_top_sets ENABLE ROW LEVEL SECURITY;

-- Own-row read + the one client write this feature needs (the freeze itself). No
-- UPDATE/DELETE policy — nothing about a frozen row is meant to change after insert.
CREATE POLICY "Users read own daily top sets"
  ON public.daily_top_sets FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users freeze own daily top set"
  ON public.daily_top_sets FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

REVOKE UPDATE, DELETE ON public.daily_top_sets FROM authenticated, anon;

-- The hot lookup: "does this user already have a frozen set for today" — also the
-- index backing the UNIQUE constraint above.
CREATE INDEX IF NOT EXISTS idx_daily_top_sets_user_day
  ON public.daily_top_sets(user_id, day);
