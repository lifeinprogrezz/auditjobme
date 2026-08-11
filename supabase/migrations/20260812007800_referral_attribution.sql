-- Issue #78: referral ATTRIBUTION only (the reward half is blocked on #35 and is
-- deliberately absent — no benefit, no cap interaction, nothing reads these tables
-- to grant anything). Attribution ships at launch because an organic invite that
-- happens without it makes the referral graph unrecoverable (same never-discard-data
-- guardrail as #77).
--
-- Two pieces, both mirroring the inbound_tokens pattern (20260811210000):
--   1. referral_tokens — the per-user invite token behind `auditjob.me/?ref={token}`.
--      Server-generated (128 random bits via gen_random_uuid), own-row SELECT only,
--      minted through a SECURITY DEFINER RPC — clients can never choose a token.
--   2. referrals — the attribution edge: who referred whom, when the referee signed
--      up. SERVER-written only: zero client write privilege on the table; the ONLY
--      writer is claim_referral(), a definer-rights RPC that derives every value
--      server-side (referrer from the token lookup, referee from auth.uid(),
--      signed_up_at from auth.users.created_at). This is the #78 fraud surface, so
--      like applications.confirmed_at it is enforced in the data layer:
--        - a client cannot INSERT/UPDATE/DELETE referrals at all,
--        - the referee is always the CALLER — nobody can attribute somebody else,
--        - the referrer comes from the server-side token lookup, never a client id,
--        - one referrer per referee, forever (PRIMARY KEY on referee_id; first
--          claim wins, later claims are a no-op),
--        - self-referral is refused,
--        - only a FRESH account can be claimed (7-day window from auth.users
--          .created_at): "signed up with an invite" is a sign-up-time fact. The
--          window is 7 days rather than hours only so a transient failure of the
--          post-sign-up claim call can retry on a later visit.
--      The future qualifying event (the referee's first CONFIRMED application,
--      decided 2026-07-26) reads applications.confirmed_at, which is already
--      client-tamper-proof via the #75 guard trigger — NOT touched here.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
-- Re-runnable: every statement below is guarded, so applying twice is a no-op.

CREATE TABLE IF NOT EXISTS public.referral_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_tokens ENABLE ROW LEVEL SECURITY;

-- No client write path at all (the RPC below is the only writer); own-row SELECT so
-- Settings can show the invite link.
REVOKE INSERT, UPDATE, DELETE ON public.referral_tokens FROM authenticated, anon;

DROP POLICY IF EXISTS "Users read own referral token" ON public.referral_tokens;
CREATE POLICY "Users read own referral token"
  ON public.referral_tokens FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Token minting: SECURITY DEFINER so the insert lands past the REVOKE above.
-- search_path locked to '' (every name schema-qualified). Idempotent: a second call
-- returns the existing token unchanged. 32 hex chars = 128 random bits.
CREATE OR REPLACE FUNCTION public.get_or_create_referral_token()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  tok text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT t.token INTO tok FROM public.referral_tokens t WHERE t.user_id = uid;
  IF tok IS NULL THEN
    tok := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.referral_tokens (user_id, token)
    VALUES (uid, tok)
    ON CONFLICT (user_id) DO NOTHING;
    -- Concurrent first calls: whoever lost the race reads the winner's token.
    SELECT t.token INTO tok FROM public.referral_tokens t WHERE t.user_id = uid;
  END IF;
  RETURN tok;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_referral_token() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_token() TO authenticated;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.referrals (
  -- PRIMARY KEY on the referee: one referrer per referee, ever. First claim wins.
  referee_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- When the referee's account was created (from auth.users.created_at), not when
  -- the claim ran — the attribution fact is the sign-up.
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self_referral CHECK (referrer_id <> referee_id)
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Server-written only (claim_referral below is the sole writer); each party sees
-- the rows they are part of — the referrer their sign-ups, the referee who
-- invited them.
REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM authenticated, anon;

DROP POLICY IF EXISTS "Referral parties read own rows" ON public.referrals;
CREATE POLICY "Referral parties read own rows"
  ON public.referrals FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = referrer_id OR (SELECT auth.uid()) = referee_id);

-- Covering index for the referrer_id foreign key (referee_id is the PK).
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

-- The ONLY writer into referrals. Returns true when an attribution row was
-- recorded, false when the claim was refused or a no-op (invalid token,
-- self-referral, already claimed, account too old). Refusals return false rather
-- than raising so the client call stays fire-and-forget.
CREATE OR REPLACE FUNCTION public.claim_referral(ref_token text)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  ref_referrer uuid;
  account_created timestamptz;
  inserted int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Referrer from the server-side token lookup — never a client-supplied id.
  SELECT t.user_id INTO ref_referrer
    FROM public.referral_tokens t WHERE t.token = ref_token;
  IF ref_referrer IS NULL THEN
    RETURN false; -- unknown token
  END IF;
  IF ref_referrer = uid THEN
    RETURN false; -- self-referral
  END IF;

  -- "At sign-up" enforcement: only a fresh account is attributable. 7 days so a
  -- failed post-sign-up claim can retry on a later visit, but an established
  -- account clicking somebody's link is never rewritten into a referral.
  -- Fails closed on a NULL created_at: an account whose age cannot be proven
  -- is never attributed.
  SELECT u.created_at INTO account_created FROM auth.users u WHERE u.id = uid;
  IF account_created IS NULL OR account_created < now() - interval '7 days' THEN
    RETURN false;
  END IF;

  INSERT INTO public.referrals (referee_id, referrer_id, signed_up_at)
  VALUES (uid, ref_referrer, account_created)
  ON CONFLICT (referee_id) DO NOTHING; -- first claim wins, forever
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;
