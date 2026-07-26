-- Issue #84 (launch gate): data export + real account deletion.
--
-- The product launches Europe-only to European residents, so "give me everything you
-- hold about me" and "delete my account" are obligations, not preference-surface
-- polish. Export needs no schema change at all: every user table already carries an
-- own-row SELECT policy, so the signed-in client reads its own rows and assembles the
-- file (src/lib/account.ts). Deletion needs the two things below.
--
-- 1. THE CASCADE HAS TO BE COMPLETE. Walked the schema table by table instead of
--    assuming, and three tables carry user_id with NO foreign key at all:
--    device_fingerprints (20260325184125), feedback (20260324130635) and purchases
--    (20260326103034). Deleting the auth user left every one of their rows behind,
--    keyed to an account that no longer exists. They get the same
--    REFERENCES auth.users(id) ON DELETE CASCADE the other ten user tables have.
--
-- 2. A CLIENT CANNOT DELETE FROM auth.users. A definer-rights function scoped to
--    auth.uid() is the whole delete path: one row, always the caller's own, and the
--    foreign keys do the rest.
--
-- DELIBERATELY NOT TOUCHED: status_events.application_id stays ON DELETE SET NULL
-- (20260726093000). Un-applying one role detaches its outcome history and keeps it;
-- deleting the ACCOUNT removes it, through status_events.user_id -> auth.users, which
-- already cascades. Two different cases, deliberately different.
--
-- whitelisted_emails is left alone on purpose: it is an invite allowlist keyed by an
-- email address, service-role only, and it is not data belonging to a signed-in
-- account (no account row points at it, and deleting an account must not silently
-- revoke an invite someone else granted).
--
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
-- Re-runnable: every statement below is guarded, so applying twice is a no-op.

-- 1. The three tables that never cascaded ------------------------------------------
--
-- Rows keyed to an account that no longer exists are exactly the residue this issue
-- exists to stop keeping, and they would also block a validated foreign key. Clear
-- them first, then add the constraint so it is valid from the start (a NOT VALID one
-- would leave the same drift undetected next time).

delete from public.device_fingerprints d
  where not exists (select 1 from auth.users u where u.id = d.user_id);
alter table public.device_fingerprints
  drop constraint if exists device_fingerprints_user_id_fkey;
alter table public.device_fingerprints
  add constraint device_fingerprints_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

delete from public.feedback f
  where not exists (select 1 from auth.users u where u.id = f.user_id);
alter table public.feedback
  drop constraint if exists feedback_user_id_fkey;
alter table public.feedback
  add constraint feedback_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

delete from public.purchases p
  where not exists (select 1 from auth.users u where u.id = p.user_id);
alter table public.purchases
  drop constraint if exists purchases_user_id_fkey;
alter table public.purchases
  add constraint purchases_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- Covering indexes for the two new foreign keys (device_fingerprints already has one).
-- Same reasoning as 20260615120100: an unindexed foreign key makes every cascade scan
-- the child table, and the Supabase advisor flags it.
create index if not exists feedback_user_idx on public.feedback (user_id);
create index if not exists purchases_user_idx on public.purchases (user_id);

-- 2. The delete path ----------------------------------------------------------------
--
-- SECURITY DEFINER because auth.users is not the client's to touch, and the caller
-- deliberately has no privilege on it. The function reads auth.uid() itself and takes
-- no argument, so there is no user id a caller could pass to delete somebody else.
-- The owning role is whoever applies this migration: checked read-only against the
-- project on 2026-07-26, that is `postgres`, and has_table_privilege('postgres',
-- 'auth.users', 'DELETE') is true, so the definer path really can remove the row.
-- search_path is locked to '' (every name is schema-qualified) so a caller-controlled
-- search_path can never resolve `users` to something else — the standard hardening for
-- a definer-rights function, same as log_application_status_event().

create or replace function public.delete_own_account()
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'delete_own_account() requires a signed-in caller';
  end if;

  -- Stored audit files live in the audit-pdfs storage bucket under a {user_id}/ prefix,
  -- and storage.objects is NOT reached by the auth.users cascade. The client removes
  -- the files through the Storage API first (that deletes the bytes); this is the
  -- backstop for the case where that call failed, and it at least removes the row that
  -- makes the object reachable. Guarded: if the owning role has no privilege on the
  -- storage schema, the account deletion below must still go through.
  begin
    delete from storage.objects
      where bucket_id = 'audit-pdfs'
        and (storage.foldername(name))[1] = v_uid::text;
  exception
    when insufficient_privilege or undefined_table or undefined_function then
      raise notice 'delete_own_account(): could not clear storage objects (%), continuing with the account delete', sqlerrm;
  end;

  -- One row, the caller's own. Every public table keyed to this user cascades from here.
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes the CALLING user (auth.uid()) from auth.users; every public table keyed to that user cascades with it. Issue #84. Definer-rights because a client has no privilege on auth.users, and argument-free so it can only ever remove the caller. If a future Supabase role change leaves the owning role without DELETE on auth.users, reassign the owner: alter function public.delete_own_account() owner to supabase_auth_admin.';
