-- Account deletion did not reach the #70 backup table, so a deleted user's job
-- targets survived them. Applied to production 2026-08-19.
--
-- delete_own_account() removes the row from auth.users and relies on the foreign-key
-- cascade to empty every public table. profiles_targets_backup_20260819 was created
-- with `create table as select`, which copies data but NOT constraints, so it has no
-- foreign key and the cascade never touched it. It holds (id, target_roles,
-- target_sectors) keyed by user id: personal data, outliving the account it belongs to.
--
-- The table stays, because it is still the only rollback path for a one-way value
-- rewrite. Erasure and rollback are not in conflict: a user who leaves has their row
-- removed, and rolling back their vocabulary is moot once the account is gone.
--
-- assert_rls.sql now fails CI if any *backup* table holding a uuid user key is not
-- named here.

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

  begin
    delete from storage.objects
      where bucket_id = 'audit-pdfs'
        and (storage.foldername(name))[1] = v_uid::text;
  exception
    when insufficient_privilege or undefined_table or undefined_function then
      raise notice 'delete_own_account(): could not clear storage objects (%), continuing with the account delete', sqlerrm;
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

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes the CALLING user (auth.uid()) from auth.users; every public table keyed to that user cascades with it, PLUS the audit-pdfs storage objects and any snapshot table that carries a user key without a foreign key (those are invisible to the cascade — see profiles_targets_backup_20260819, added 2026-08-19). Issue #84. Definer-rights because a client has no privilege on auth.users, and argument-free so it can only ever remove the caller.';
