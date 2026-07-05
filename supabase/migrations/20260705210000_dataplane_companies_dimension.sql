-- Dataplane v1 (planning repo docs/specs/2026-07-05-dataplane-cloud-native-v1-spec.md):
-- companies dimension + jobs linkage. Applied to roaervdsjejksaeseeov via MCP 2026-07-05.
create table public.companies (
  slug text primary key,
  name text not null,
  website text,
  sector text,
  stage text,
  headcount_bucket text,
  hq_city text,
  hq_country text,
  linkedin_url text,
  careers_url text,
  uk_sponsor_status text, -- 'licensed' | 'unmatched' | null = unknown/not-checked (fail-safe)
  lat double precision,
  lng double precision,
  coord_precision text not null default 'none', -- 'street' | 'centroid_jitter' | 'none'
  logo_domain text,
  source text, -- 'tracked' | 'startupmap_discovered'
  open_roles_count integer,
  updated_at timestamptz not null default now()
);
alter table public.companies enable row level security;
create policy "Anyone can read companies" on public.companies
  for select to anon, authenticated using (true);
-- No write policies on purpose: writes are service-role only, same as jobs.

alter table public.jobs add column company_id text references public.companies(slug);
alter table public.jobs add column city text;
create index idx_jobs_company_id on public.jobs(company_id);
create index idx_companies_name on public.companies (lower(name));

-- Name-based backfill of jobs.company_id after each scrape upsert (called via RPC by
-- the service-role scraper; not callable by clients). v2: on duplicate company names
-- prefer the metadata-rich row (seed can hold a rich discovered row + a bare tracked row).
create or replace function public.link_jobs_to_companies()
returns integer
language sql
security definer
set search_path = public
as $$
  with best as (
    select distinct on (lower(name)) lower(name) as lname, slug
    from public.companies
    order by lower(name),
      ((sector is null)::int + (stage is null)::int + (headcount_bucket is null)::int + (hq_city is null)::int),
      slug
  ), upd as (
    update public.jobs j
    set company_id = b.slug
    from best b
    where j.company_id is null and lower(j.company) = b.lname
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke execute on function public.link_jobs_to_companies() from public, anon, authenticated;
