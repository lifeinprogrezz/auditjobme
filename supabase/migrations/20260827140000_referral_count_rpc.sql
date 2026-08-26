-- Issue #160: "N people joined through you" attribution count for Settings (E9
-- decision 5, part a). The referrals table already lets a referrer read their own
-- rows (policy "Referral parties read own rows", 20260812007800), so a plain
-- client SELECT COUNT would already pass RLS — this RPC exists so Settings does
-- one small round trip for a number instead of pulling every row just to measure
-- its length, mirroring the get_or_create_referral_token() shape ReferralSection
-- already calls.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase
-- MCP. Re-runnable: CREATE OR REPLACE, so applying twice is a no-op. A client on
-- a not-yet-migrated environment gets a "function does not exist" error, which
-- src/lib/referral.ts's isMissingReferralCountFn() recognizes so Settings hides
-- the count instead of showing a broken state.

CREATE OR REPLACE FUNCTION public.my_referral_count()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  STABLE
AS $$
  SELECT count(*)::integer
    FROM public.referrals
   WHERE referrer_id = (SELECT auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.my_referral_count() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_count() TO authenticated;
