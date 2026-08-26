-- Daily spend alert (issue #137): the numbers api/spend-alert.ts compares.
-- NOT yet applied to production — apply before the spend-alert workflow's first run.
--
-- Nothing watched spend, so a cost step function (a RUBRIC_VERSION bump, a
-- catalogue expansion) was invisible until the Anthropic invoice. One RPC returns
-- everything the alert needs, summed IN THE DATABASE for the same reason as
-- global_month_spend_usd(): an un-ranged select is capped at 1000 rows by
-- PostgREST, and usage_events has 15,000+ rows a month.
--
-- All days are UTC. "Yesterday" is the UTC day before the call; "trailing" is
-- the 7 UTC days before yesterday, zero-filled so a quiet day still counts.
-- The partial index from 20260819190000 (created_at include cost_usd) covers
-- the date-ranged sums; the per-user split reads user_id too, which is fine at
-- one day of rows.

create or replace function public.spend_alert_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('day', now() at time zone 'utc') as today,
      date_trunc('day', now() at time zone 'utc') - interval '1 day' as yesterday,
      date_trunc('day', now() at time zone 'utc') - interval '8 days' as trailing_start,
      date_trunc('month', now() at time zone 'utc') as month_start
  ),
  trailing as (
    select d::date as day,
           coalesce((select sum(e.cost_usd) from public.usage_events e
                     where e.created_at >= d and e.created_at < d + interval '1 day'), 0)::numeric as cost
    from bounds b, generate_series(b.trailing_start, b.yesterday - interval '1 day', interval '1 day') as d
  ),
  users as (
    select e.user_id, sum(e.cost_usd)::numeric as cost
    from public.usage_events e, bounds b
    where e.created_at >= b.yesterday and e.created_at < b.today
    group by e.user_id
    order by cost desc
  )
  select jsonb_build_object(
    'yesterday', (select coalesce(sum(e.cost_usd), 0)::numeric from public.usage_events e, bounds b
                  where e.created_at >= b.yesterday and e.created_at < b.today),
    'month_to_date', (select coalesce(sum(e.cost_usd), 0)::numeric from public.usage_events e, bounds b
                      where e.created_at >= b.month_start),
    'trailing_days', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'cost', cost) order by day), '[]'::jsonb) from trailing),
    'yesterday_users', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'cost', cost)), '[]'::jsonb) from users)
  );
$$;

comment on function public.spend_alert_snapshot is
  'Numbers for the daily spend alert (api/spend-alert.ts, issue #137): yesterday''s total, month-to-date, the 7 zero-filled daily totals before yesterday, and yesterday''s per-user totals, all UTC and summed in the database. Signal only: no enforcement reads this.';

revoke all on function public.spend_alert_snapshot() from public, anon, authenticated;
grant execute on function public.spend_alert_snapshot() to service_role;
