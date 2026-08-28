-- Erasure must actually remove the user's stored audit PDFs (2026-08-28).
--
-- Supabase guards storage.objects with a BEFORE DELETE trigger, storage.protect_delete(),
-- that raises 42501 unless the session setting storage.allow_delete_query is 'true'.
-- delete_own_account() ran its storage delete inside an exception block that
-- swallows exactly that code (insufficient_privilege), logged a notice, and carried
-- on to delete the auth row. So for a user WITH audit PDFs the button reported
-- success, the account vanished, and their PDFs stayed in the bucket under a prefix
-- nothing could ever reach again. Silent, not loud — the worst shape (see the
-- silent-failure class in the planning repo memory). Found while deleting a test
-- account by hand on 2026-08-28.
--
-- The trigger's own escape hatch is the fix: set the flag LOCAL to this transaction
-- (third argument true) so it never leaks past the function, then delete. The
-- exception block stays for the environments where the trigger or the setting is
-- absent — but a raise from the trigger itself can no longer be mistaken for one.
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
  -- and storage.objects is NOT reached by the auth.users cascade. The protect_delete
  -- trigger allows a direct delete only while this transaction-local flag is set.
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects
      where bucket_id = 'audit-pdfs'
        and (storage.foldername(name))[1] = v_uid::text;
  exception
    when undefined_table or undefined_function then
      raise notice 'delete_own_account(): storage tables absent (%), continuing with the account delete', sqlerrm;
  end;

  -- Snapshot tables made with `create table as select` carry no foreign key, so the
  -- cascade below cannot see them. Any future backup holding a user key must be added
  -- here in the same migration that creates it. Guarded so a dropped snapshot can
  -- never block someone's erasure request.
  begin
    delete from public.profiles_targets_backup_20260819 where id = v_uid;
  exception
    when undefined_table then
      raise notice 'delete_own_account(): profiles_targets_backup_20260819 absent, skipping';
  end;

  -- One row, the caller's own. Every public table keyed to this user cascades from here.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
