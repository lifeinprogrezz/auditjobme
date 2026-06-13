-- Private-by-default (spec §4): close the anon email leak, make new audits private,
-- and expose only safe author fields (no email) to the public share page.
-- Applied to the owned project roaervdsjejksaeseeov on 2026-06-13 (via MCP).

-- New audits are private by default; publishing a share link is the explicit opt-in.
ALTER TABLE public.audits ALTER COLUMN is_published SET DEFAULT false;

-- Stop exposing full profile rows (including email) to anon.
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- A logged-in user can read their OWN profile (restores the read migration 14 dropped).
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- Safe, public-only window into authors who have a published audit (NO email), for the
-- public share page. Definer-rights view exposes just these columns without granting
-- direct table access (RLS can't column-restrict, so a view is required).
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
  SELECT p.id, p.username, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1 FROM public.audits a WHERE a.user_id = p.id AND a.is_published = true
  );
GRANT SELECT ON public.public_profiles TO anon, authenticated;
