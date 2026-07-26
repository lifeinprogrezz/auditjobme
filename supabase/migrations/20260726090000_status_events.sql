-- Issue #77: status_events — the application-outcome ledger.
--
-- public.applications keeps only the CURRENT status, so every card move overwrites the
-- previous stage and its date. Time-to-response, stage-by-stage drop-off and response
-- rate by company type are unrecoverable unless they are captured as they happen; there
-- is no backfill, because the history was never stored. This table is the ledger, and a
-- database trigger is the writer, so EVERY status move is captured: the manual kanban
-- moves today and the automated ones a later inbox slice will make, unchanged.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
-- Re-runnable: every statement below is guarded, so applying twice is a no-op.

CREATE TABLE IF NOT EXISTS public.status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_status text,                          -- NULL on the first event (the initial applied)
  to_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- No CHECK on the status values on purpose. The ledger records whatever the tracker
-- wrote; a constraint here would let a new stage abort the user's own status update
-- (the trigger runs inside their transaction). Stage vocabulary stays in src/lib/tracker.ts.
--
-- ON DELETE CASCADE on both foreign keys, matching applications + saved_jobs. Deleting a
-- user must erase their data; deleting an application is the user un-applying (a mis-click
-- correction in Apply.tsx), and its events describe an application that no longer exists.

ALTER TABLE public.status_events ENABLE ROW LEVEL SECURITY;

-- Least-privilege, split-policy style (mirrors daily_matches + the tightened usage_events
-- grants): the trigger writes server-side, so there is NO client write path at all. Deny
-- writes at the privilege layer AND give clients own-row SELECT only — an append-only
-- ledger a client could edit would be worthless as outcome data.
REVOKE INSERT, UPDATE, DELETE ON public.status_events FROM authenticated, anon;

DROP POLICY IF EXISTS "Users read own status events" ON public.status_events;
CREATE POLICY "Users read own status events"
  ON public.status_events FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- (user_id, changed_at) serves both the own-row RLS filter and "my ledger, newest first";
-- its leftmost prefix covers plain user_id lookups. (application_id) is the per-application
-- timeline and the covering index for that foreign key.
CREATE INDEX IF NOT EXISTS idx_status_events_user_changed
  ON public.status_events(user_id, changed_at);
CREATE INDEX IF NOT EXISTS status_events_application_id_idx
  ON public.status_events(application_id);

-- SECURITY DEFINER so the insert lands past the RLS + REVOKE above: the trigger fires as
-- the signed-in user, who deliberately has no write path to this table. search_path is
-- locked to '' (every name below is schema-qualified) so a caller-controlled search_path
-- can never resolve `status_events` to something else — the standard hardening for a
-- definer-rights function.
CREATE OR REPLACE FUNCTION public.log_application_status_event()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- First event of the application's life. from_status NULL = "there was no prior
    -- stage". changed_at follows applied_at so a backdated insert stays honest.
    INSERT INTO public.status_events (user_id, application_id, from_status, to_status, changed_at)
    VALUES (NEW.user_id, NEW.id, NULL, NEW.status, NEW.applied_at);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Belt-and-suspenders: the trigger's WHEN clause already filters no-op updates.
    INSERT INTO public.status_events (user_id, application_id, from_status, to_status, changed_at)
    VALUES (NEW.user_id, NEW.id, OLD.status, NEW.status, now());
  END IF;
  RETURN NULL;   -- AFTER trigger: the return value is ignored
END;
$$;

-- Never a callable RPC; triggers run as the table owner regardless of EXECUTE grants
-- (same reasoning as handle_new_user in 20260614185500_harden_security_advisors.sql).
REVOKE EXECUTE ON FUNCTION public.log_application_status_event() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS applications_log_status_insert ON public.applications;
CREATE TRIGGER applications_log_status_insert
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.log_application_status_event();

-- UPDATE OF status narrows it to statements that touch the column; the WHEN clause makes
-- sure a no-op move (same value written again, e.g. dropping a card back on its own
-- column) writes no event at all.
DROP TRIGGER IF EXISTS applications_log_status_update ON public.applications;
CREATE TRIGGER applications_log_status_update
  AFTER UPDATE OF status ON public.applications
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.log_application_status_event();
