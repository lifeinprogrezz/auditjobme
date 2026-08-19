-- The $300 global spend cap was reading a TRUNCATED ledger and could never trip.
-- Applied to production 2026-08-19.
--
-- anthropic-proxy summed month-to-date spend with
--   .from('usage_events').select('cost_usd').gte('created_at', monthStart)
-- which PostgREST caps at 1000 rows, silently. Measured: 15,422 events this month,
-- true total $35.03, what the cap could see $2.58 — about 7%. The gap WIDENS as
-- usage grows, so the cap could never have tripped: reaching $300 inside 1000 rows
-- would need $0.30 an event, roughly 120x the real per-call cost.
--
-- Summing in the database fixes it properly rather than by paging: one row back
-- instead of 15,000+, and the cost does not grow with the month. This runs on every
-- LLM call, so the partial index keeps it cheap.

create index if not exists usage_events_created_at_cost_idx
  on public.usage_events (created_at)
  include (cost_usd);

create or replace function public.global_month_spend_usd()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from public.usage_events
  where created_at >= date_trunc('month', now() at time zone 'utc');
$$;

comment on function public.global_month_spend_usd is
  'Month-to-date sponsored-compute spend in USD, summed IN THE DATABASE. The proxy''s global cap calls this instead of selecting rows: an un-ranged select returns PostgREST''s first 1000 rows, which made the cap read ~7% of real spend and rendered the kill switch inert (2026-08-19). Returns 0, never null, so the caller can distinguish a real zero from a read failure.';

revoke all on function public.global_month_spend_usd() from public, anon, authenticated;
grant execute on function public.global_month_spend_usd() to service_role;
