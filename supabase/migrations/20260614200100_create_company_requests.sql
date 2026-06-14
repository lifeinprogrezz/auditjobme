-- Company request flow (#7): users request a company; promotion to the pool is a later step.
create table public.company_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  careers_url text,
  note text,
  status text not null default 'requested' check (status in ('requested','accepted','declined')),
  created_at timestamptz not null default now()
);
alter table public.company_requests enable row level security;
create policy "Users insert own requests" on public.company_requests for insert to authenticated with check (auth.uid() = user_id);
create policy "Users read own requests" on public.company_requests for select to authenticated using (auth.uid() = user_id);
create index company_requests_user_idx on public.company_requests (user_id, created_at);
