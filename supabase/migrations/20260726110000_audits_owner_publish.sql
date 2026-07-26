-- #90: audits start private, and publishing is now an explicit action the
-- owner takes on an already-saved audit (AuditGenerator's new "Publish & Get
-- Link" control), not a flag baked in at insert time. That requires an UPDATE
-- path that did not exist before: public.audits has only ever had SELECT /
-- INSERT / DELETE policies (audits were create-once, read, or delete -- see
-- 20260323161826_e9579993-e64e-424b-8338-5c4ec7c54109.sql), so a client
-- attempting `update audits set is_published = true ...` was silently blocked
-- by RLS with zero rows affected. Scoped to the owning row only, matching the
-- (select auth.uid()) = user_id pattern every other own-row policy on this
-- table already uses (20260615120100_rls_initplan_and_fk_indexes.sql).
--
-- The owner's own-row SELECT (so they can still read an unpublished audit)
-- already exists -- "Users can view own audits", same migration as above --
-- and needed no change here.
CREATE POLICY "Users can publish own audits"
  ON public.audits FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- CI's migrations+RLS gate (F10, supabase/tests/assert_rls.sql) caught a real gap
-- here: a fresh stack built purely from these migration files has never carried a
-- table-level GRANT on public.audits for authenticated/anon -- every existing
-- role-switch block in that test either calls a SECURITY DEFINER function or
-- seeds as the superuser connection, so this table never had a client role
-- attempt direct DML against it until the #90 behavioural pin added one. RLS
-- policies alone do not authorize a query; Postgres checks the table-level ACL
-- first ("permission denied for table audits", not an RLS violation, is exactly
-- what a fresh stack raised on run 30217445782). These GRANTs match the
-- privileges the table needs in prod today (owner SELECT/INSERT/DELETE from
-- 20260323161826, owner UPDATE from this file, public SELECT-when-published from
-- 20260323162818) and are idempotent there -- re-granting an already-held
-- privilege is a no-op, not an error.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audits TO authenticated;
GRANT SELECT ON public.audits TO anon;
