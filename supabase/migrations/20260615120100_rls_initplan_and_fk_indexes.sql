-- #11 advisor pass (perf-only), applied 2026-06-15. Access logic is byte-identical;
-- each RLS policy is dropped + recreated with the SAME cmd/roles/USING/WITH CHECK,
-- wrapping auth.uid() in (select ...) so Postgres evaluates it once per query instead
-- of once per row (the auth_rls_initplan lint). Plus covering indexes for the 4 FKs.
-- Atomic: any failure rolls the whole thing back, so there is no partial/broken state.
--
-- NOT changed here: public_profiles stays SECURITY DEFINER on purpose — it's the
-- controlled public exposure of safe author fields (id/username/display_name/avatar_url)
-- for published audits; flipping it to security_invoker would break anonymous author
-- display (anon has no profiles read policy, by design). Accepted advisor exception.

-- applications
drop policy "Users manage own applications" on public.applications;
create policy "Users manage own applications" on public.applications for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- artifacts
drop policy "Users manage own artifacts" on public.artifacts;
create policy "Users manage own artifacts" on public.artifacts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- audits
drop policy "Users can delete own audits" on public.audits;
create policy "Users can delete own audits" on public.audits for delete to authenticated
  using ((select auth.uid()) = user_id);
drop policy "Users can insert own audits" on public.audits;
create policy "Users can insert own audits" on public.audits for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy "Users can view own audits" on public.audits;
create policy "Users can view own audits" on public.audits for select to authenticated
  using ((select auth.uid()) = user_id);

-- company_requests
drop policy "Users insert own requests" on public.company_requests;
create policy "Users insert own requests" on public.company_requests for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy "Users read own requests" on public.company_requests;
create policy "Users read own requests" on public.company_requests for select to authenticated
  using ((select auth.uid()) = user_id);

-- device_fingerprints
drop policy "Users can insert own fingerprints" on public.device_fingerprints;
create policy "Users can insert own fingerprints" on public.device_fingerprints for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy "Users can view own fingerprints" on public.device_fingerprints;
create policy "Users can view own fingerprints" on public.device_fingerprints for select to authenticated
  using ((select auth.uid()) = user_id);

-- feedback
drop policy "Users can insert own feedback" on public.feedback;
create policy "Users can insert own feedback" on public.feedback for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy "Users can view own feedback" on public.feedback;
create policy "Users can view own feedback" on public.feedback for select to authenticated
  using ((select auth.uid()) = user_id);

-- profiles (keyed on id)
drop policy "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id);
drop policy "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

-- purchases
drop policy "Users can view own purchases" on public.purchases;
create policy "Users can view own purchases" on public.purchases for select to authenticated
  using ((select auth.uid()) = user_id);

-- scores
drop policy "Users manage own scores" on public.scores;
create policy "Users manage own scores" on public.scores for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- usage_events (SELECT only; INSERT was locked to service-role in the prior migration)
drop policy "Users read own usage" on public.usage_events;
create policy "Users read own usage" on public.usage_events for select to authenticated
  using ((select auth.uid()) = user_id);

-- Covering indexes for the unindexed foreign keys (show as "unused" until there's traffic).
create index if not exists applications_job_id_idx on public.applications (job_id);
create index if not exists artifacts_job_id_idx on public.artifacts (job_id);
create index if not exists device_fingerprints_audit_id_idx on public.device_fingerprints (audit_id);
create index if not exists scores_job_id_idx on public.scores (job_id);
