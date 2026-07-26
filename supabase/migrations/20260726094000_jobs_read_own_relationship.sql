-- Issue #73 slice 2, review round 1: make the in-flight COMPANY collapse survive a
-- posting closing mid-conversation.
--
-- The bug is in the data layer, not the client. jobs' only authenticated read policy
-- is USING (is_live = true), so a client "fetch by id without the is_live filter"
-- STILL comes back empty once the scraper flips a posting dead (392 of 1238 prod rows
-- are is_live=false today). An application whose posting closed then failed to resolve
-- to a company, and that company's other roles resurfaced in the Today queue while the
-- interview was live — the exact harm cap-1-per-company exists to prevent. The same
-- silent hole emptied the Saved section (savedJobsRaw) and, with slice 4, would have
-- made a dismissed-then-expired role unrestorable from the /settings undo list.
--
-- Fix: a user may read a job row they have a PERSONAL RELATIONSHIP with — applied,
-- saved, or dismissed — regardless of liveness. Permissive policies OR together, so
-- this only ADDS access; the live-pool policy is untouched and anon is unchanged.
-- Rows are public postings scraped from public boards (no user data), and each EXISTS
-- is scoped to (select auth.uid()), so nothing leaks across users. Cost on the /roles
-- scan is nil: that query filters is_live = true, and the OR short-circuits on the
-- cheap qual before any EXISTS runs. auth.uid() is wrapped per the initplan
-- convention (20260615120100); each EXISTS rides the UNIQUE (user_id, job_id) index.
--
-- ORDERING: apply AFTER 20260726092000_dismissed_jobs.sql — this references that table.
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.

DROP POLICY IF EXISTS "Users read jobs they have a relationship with" ON public.jobs;
CREATE POLICY "Users read jobs they have a relationship with"
  ON public.jobs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = jobs.id AND a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.saved_jobs s
      WHERE s.job_id = jobs.id AND s.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.dismissed_jobs d
      WHERE d.job_id = jobs.id AND d.user_id = (SELECT auth.uid())
    )
  );
