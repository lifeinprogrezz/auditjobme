-- Acceptance panel, 2026-07-26, confirmed live in prod pg_policies: "Anyone can
-- view published audits" (SELECT, is_published = true) is granted TO anon only.
-- A signed-in auditjob.me user who is not the audit's owner has no SELECT path
-- to a published-but-not-owned row at all -- "Users can view own audits" only
-- covers auth.uid() = user_id, and the anon-only policy doesn't apply to the
-- authenticated role. So a signed-in visitor following a /a/:username/:slug
-- share link (issue #82's route, live again since #90 made publishing an
-- explicit owner action) gets zero rows and an empty page, while an anonymous
-- visitor -- the primary intended audience, companies checking the link cold --
-- sees it fine. That asymmetry is why it went unnoticed until now.
--
-- Fix: extend the SAME policy's role list to cover authenticated too, rather
-- than adding a second policy or widening the qual. `TO public` would be the
-- terser way to say "any role", but every table-level RLS policy already in
-- this repo lists roles explicitly (authenticated singly, or anon singly for
-- "Anyone can view published audits" and "Anyone can view profiles" in
-- 20260323162818) and the one place `TO public` WAS used on a table policy --
-- "Anyone can view PDFs" on storage.objects -- was deliberately dropped in
-- 20260614185500_harden_security_advisors.sql specifically because granting to
-- the public role enabled enumeration. So an explicit role list is the house
-- style here, and the comma-separated form already appears in this codebase for
-- GRANTs (`GRANT SELECT ON public.public_profiles TO anon, authenticated;`,
-- 20260613120000_private_by_default.sql). DROP + CREATE matches how this repo
-- edits an existing policy elsewhere (20260726094000_jobs_read_own_relationship.sql),
-- rather than ALTER POLICY.
--
-- Nothing else changes: the qual stays is_published = true (an unpublished
-- audit is still invisible to everyone but its owner -- that guarantee is the
-- whole point of #90, decided by Rober the same day this bug surfaced), and the
-- owner-only SELECT, owner-only UPDATE (publishing), INSERT, and DELETE
-- policies are untouched. authenticated already holds table-level SELECT via
-- the GRANT in 20260726110000_audits_owner_publish.sql, so no GRANT change is
-- needed here -- only the RLS policy was blocking the read.
--
-- Written but NOT auto-applied -- the orchestrator applies this to prod via
-- the Supabase MCP; prod pg_policies is the source of truth this migration was
-- read from.
DROP POLICY IF EXISTS "Anyone can view published audits" ON public.audits;
CREATE POLICY "Anyone can view published audits"
  ON public.audits FOR SELECT
  TO anon, authenticated
  USING (is_published = true);
