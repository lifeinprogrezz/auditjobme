-- Issue #75: inbox → tracker auto-advance (Option A — per-user forwarding address).
--
-- Each user gets a unique inbound address `u-{token}@track.auditjob.me`; one guided
-- Gmail filter forwards their applicant-tracking-system mail there, and the inbound
-- endpoint (api/inbound-email.ts, service role) advances the tracker. Status moves go
-- through UPDATE public.applications, so the #77 status_events trigger events every
-- automated transition exactly like a manual one — evented from day one.
--
-- Three pieces:
--   1. inbound_tokens — the per-user token. Server-generated (128 random bits via
--      gen_random_uuid, no pgcrypto dependency), unguessable, own-row SELECT only,
--      created through a SECURITY DEFINER RPC — clients can never choose a token.
--      Also carries the Gmail forwarding-confirmation code: when the user adds the
--      address in Gmail, Google mails the verification code TO that address (i.e. to
--      us); the endpoint parses it onto the row so Settings can show it back.
--   2. inbound_emails — a minimal parse ledger: what arrived, how it classified, what
--      we did. Deliberately stores NO subject and NO body — classification metadata
--      only (privacy posture: we hold the least we can). message_id gives idempotency
--      against provider redeliveries. Feeds honest per-user funnel stats later.
--   3. applications.confirmed_at — stamped on the first ATS confirmation email. The
--      status stays 'applied'; the timestamp is the value (funnel stats now, the
--      referral qualifying event #78 later).
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
-- Re-runnable: every statement below is guarded, so applying twice is a no-op.

CREATE TABLE IF NOT EXISTS public.inbound_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  gmail_confirmation_code text,
  gmail_confirmation_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbound_tokens ENABLE ROW LEVEL SECURITY;

-- Same least-privilege split as status_events: no client write path at all (the RPC
-- below and the service-role endpoint are the only writers), own-row SELECT so the
-- Settings page can show the address and the Gmail confirmation code.
REVOKE INSERT, UPDATE, DELETE ON public.inbound_tokens FROM authenticated, anon;

DROP POLICY IF EXISTS "Users read own inbound token" ON public.inbound_tokens;
CREATE POLICY "Users read own inbound token"
  ON public.inbound_tokens FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Token creation: SECURITY DEFINER so the insert lands past the REVOKE above.
-- search_path locked to '' (every name schema-qualified) — standard definer-rights
-- hardening, same as log_application_status_event. Idempotent: a second call returns
-- the existing token unchanged. 32 hex chars = 128 random bits; the token is the
-- whole security of the inbound address, so it is never client-supplied.
CREATE OR REPLACE FUNCTION public.get_or_create_forwarding_token()
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
  SELECT t.token INTO tok FROM public.inbound_tokens t WHERE t.user_id = uid;
  IF tok IS NULL THEN
    tok := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.inbound_tokens (user_id, token)
    VALUES (uid, tok)
    ON CONFLICT (user_id) DO NOTHING;
    -- Concurrent first calls: whoever lost the race reads the winner's token.
    SELECT t.token INTO tok FROM public.inbound_tokens t WHERE t.user_id = uid;
  END IF;
  RETURN tok;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_forwarding_token() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_forwarding_token() TO authenticated;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id text,                            -- provider Message-ID, for idempotency; may be absent
  from_domain text,
  ats text,                                   -- greenhouse | lever | … | NULL (company's own domain)
  classification text NOT NULL,               -- confirmation | rejection | interview | unknown
  action text NOT NULL,                       -- advanced | confirmed | skipped | no_match | duplicate | gmail_confirmation
  detail text,                                -- short reason ("stale rejection …"), never email content
  -- ON DELETE SET NULL, matching status_events: the parse ledger outlives an
  -- un-applied application (learning loop: outcome data is never discarded).
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;

-- Server-only writes (the endpoint uses the service role), own-row SELECT.
REVOKE INSERT, UPDATE, DELETE ON public.inbound_emails FROM authenticated, anon;

DROP POLICY IF EXISTS "Users read own inbound emails" ON public.inbound_emails;
CREATE POLICY "Users read own inbound emails"
  ON public.inbound_emails FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Idempotency: one processing record per (user, Message-ID). Partial — mails
-- without a Message-ID can't be deduplicated and are processed as they arrive.
CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_user_message_uniq
  ON public.inbound_emails(user_id, message_id) WHERE message_id IS NOT NULL;

-- Own-ledger reads newest-first + covering index for the user_id foreign key.
CREATE INDEX IF NOT EXISTS idx_inbound_emails_user_received
  ON public.inbound_emails(user_id, received_at);
-- Covering index for the application_id foreign key (matches status_events style).
CREATE INDEX IF NOT EXISTS inbound_emails_application_id_idx
  ON public.inbound_emails(application_id);

-- ---------------------------------------------------------------------------

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

COMMENT ON COLUMN public.applications.confirmed_at is
  'When the ATS confirmation email for this application arrived (issue #75). Stamped once, server-side, by the inbound-email endpoint; NULL = no confirmation seen. The referral qualifying event (#78) reads this.';

-- applications has an own-row FOR ALL policy, so without a guard a signed-in user
-- could stamp their own confirmed_at — and confirmed_at is exactly what the referral
-- qualifying event (#78) will pay out on. Hostile-reader rule: enforce in the data
-- layer. This trigger silently discards client-side changes to the column (the user's
-- legitimate edit — status, notes — still goes through); the service-role endpoint
-- has no JWT, auth.uid() is NULL there, so the server write path is untouched.
CREATE OR REPLACE FUNCTION public.protect_applications_confirmed_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.confirmed_at := NULL;
    ELSE
      NEW.confirmed_at := OLD.confirmed_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_applications_confirmed_at() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS applications_protect_confirmed_at ON public.applications;
CREATE TRIGGER applications_protect_confirmed_at
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_applications_confirmed_at();
