-- Economics meter (#6): per-call AI usage + estimated cost. Owner-only RLS.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('score','audit','cv','letter')),
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  created_at timestamptz not null default now()
);
alter table public.usage_events enable row level security;
create policy "Users insert own usage" on public.usage_events for insert to authenticated with check (auth.uid() = user_id);
create policy "Users read own usage" on public.usage_events for select to authenticated using (auth.uid() = user_id);
create index usage_events_user_idx on public.usage_events (user_id, created_at);
