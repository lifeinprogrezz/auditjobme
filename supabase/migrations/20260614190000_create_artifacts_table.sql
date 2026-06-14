-- Per CV+letter port design (planning docs/specs/2026-06-14-cv-letter-port-design.md §4)
-- and DATA_CONTRACT.md. Per-user generated artifacts (cv | letter | audit). RLS owner-only.
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  kind text not null check (kind in ('cv','letter','audit')),
  content jsonb not null default '{}'::jsonb,
  visibility text not null default 'private' check (visibility in ('private','public')),
  public_slug text unique,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.artifacts enable row level security;

create policy "Users manage own artifacts" on public.artifacts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- one of each kind per (user, job) — regeneration upserts rather than piling up
create unique index artifacts_user_job_kind_idx on public.artifacts (user_id, job_id, kind) where job_id is not null;
create index artifacts_user_idx on public.artifacts (user_id);
