-- Issue #41 (warm contacts): the user's OWN LinkedIn connections export.
--
-- LinkedIn lets every member download their first-degree connections as a CSV
-- (Connections.csv). A user can optionally upload theirs in /settings; the rows
-- land here, one row per connection, and power two read surfaces:
--   - the "You know N people here" marker on Today / digest cards, and
--   - the "Who you know at {company}" panel on the Apply (prep) page.
--
-- PRIVACY POSTURE: this is the user's own data about their own network — the same
-- shape as the CV, and it gets the same treatment. Own-row RLS on every operation,
-- a cascade from auth.users so account deletion removes it, and an entry in
-- USER_DATA_TABLES (src/lib/account.ts) so the account export carries it and the
-- deletion notice names it. Nothing is shared between users, and no other user's
-- policies can reach these rows.
--
-- DELIBERATELY NO SCORING LINKAGE: the personal career-ops engine boosts scores
-- +0.3 where a first-degree connection exists; the product does NOT (recorded in
-- issue #41 so nobody "fixes" it later). No trigger, no score column, no read
-- from the scoring worker — the match is card information only.
--
-- company_key is computed CLIENT-side by companyKey() in src/lib/connections.ts
-- (lowercase, diacritics folded, legal suffixes stripped) — the same function the
-- job-card lookup uses, so both sides of the match can never disagree. It is
-- denormalized here so the Apply page can fetch one company's contacts directly.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
CREATE TABLE IF NOT EXISTS public.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  company text NOT NULL,
  company_key text NOT NULL,
  "position" text,   -- quoted: POSITION is a keyword; the column stays lowercase
  linkedin_url text,
  connected_on text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Own-row everything, same shape as saved_jobs / dismissed_jobs. (select auth.uid())
-- not bare auth.uid() — the initplan form, per 20260615120100.
CREATE POLICY "Users manage own connections"
  ON public.connections FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- Covers the auth.users cascade AND the two read paths (whole-list for the Today
-- warm index, per-company for the Apply panel).
CREATE INDEX IF NOT EXISTS idx_connections_user_company ON public.connections(user_id, company_key);
