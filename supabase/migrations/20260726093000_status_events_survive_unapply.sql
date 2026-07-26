-- Issue #77 follow-up (Rober, 2026-07-26): outcome history must survive un-applying.
--
-- The ledger shipped with ON DELETE CASCADE on application_id, so the un-apply path in
-- Apply.tsx erased that application's whole status history along with the application.
-- That contradicts the learning-loop principle the ledger exists to serve: outcome data
-- is never discarded. Un-applying is a mis-click correction, not a request to forget what
-- happened. Detach the events instead of deleting them.
--
-- Free to make today (the table has zero rows). Deferring it means a data migration later
-- plus whatever history was destroyed in between.
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
-- Re-runnable: dropping and recreating the constraint by name is idempotent.

alter table public.status_events
  alter column application_id drop not null;

alter table public.status_events
  drop constraint if exists status_events_application_id_fkey;

alter table public.status_events
  add constraint status_events_application_id_fkey
    foreign key (application_id) references public.applications(id) on delete set null;

comment on column public.status_events.application_id is
  'The application this event belongs to, or NULL once that application was deleted (un-applied). ON DELETE SET NULL, never CASCADE — the outcome history outlives the application row.';
