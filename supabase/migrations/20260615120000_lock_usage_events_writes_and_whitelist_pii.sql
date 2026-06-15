-- Security hardening (issue #12), applied 2026-06-15.
--
-- P0: usage_events is the cost-cap ledger. The proxy writes it server-side via the
-- service-role key (which bypasses RLS), so clients must never write/tamper with it.
-- A client INSERT with a negative cost_usd was zeroing the global + per-user caps,
-- defeating the entire monthly kill-switch (unbounded spend on the owner's key).
drop policy if exists "Users insert own usage" on public.usage_events;
revoke insert, update, delete on public.usage_events from authenticated, anon;

-- Belt-and-suspenders: even a future mis-grant can't land a negative/garbage cost.
alter table public.usage_events
  add constraint usage_events_nonneg
  check (cost_usd >= 0 and input_tokens >= 0 and output_tokens >= 0);

-- P2: nothing in the app reads whitelisted_emails from the client; this policy
-- exposed the owner's email to every signed-in user. Drop it (service-role still reads;
-- the table is now RLS-enabled with no policy = locked to everyone but service-role).
drop policy if exists "Allow authenticated to read whitelist" on public.whitelisted_emails;
