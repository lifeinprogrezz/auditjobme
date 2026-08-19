-- One industry vocabulary for companies.sector, and the role vocabulary the
-- profiles table stores alongside it (issue #70).
--
-- WHY. `enrich-companies.mjs` asked a model for "a short industry label e.g.
-- Fintech" and stored the answer verbatim. Measured against production on
-- 2026-08-19, the column held 54 distinct strings for 28 real industries:
-- Healthtech / Health Tech / Digital Health were three names for one thing, as
-- were Data & analytics / Data & Analytics / Data Management, and Edtech /
-- EdTech. Sector is AND-ed into both the map filter and the paid scoring
-- prefilter, so every split silently cost the user roles — picking "Healthtech"
-- hid the 43 live roles filed under "Health Tech".
--
-- Four strings are DROPPED rather than folded: SaaS, Software/SaaS, Enterprise
-- Software and AI/CX name a business model or a delivery mechanism, not an
-- industry. They are true of most of the catalog and tell a job-seeker nothing
-- about the space they would work in, so they become null.
--
-- Rule and code move together: the same 28 values live in scripts/sector-lib.mjs
-- (`SECTORS`), which is the only way any writer may set this column, and
-- src/test/sector-lib.test.ts fails if this file and that constant drift apart.
--
-- VERIFIED 2026-08-19 against a throwaway Postgres, on fixture rows carrying every
-- one of the 54 live strings: it applies clean, folds each variant onto the
-- industry named below, nulls the four dropped model-words and the unrecognised
-- strings, rewrites the profiles, is IDEMPOTENT (a second run changes nothing),
-- and the CHECK refuses a non-canonical write afterwards.
--
-- ⚠️ THIS DATA MIGRATION IS ONE-WAY at the value level — "Health Tech" and
-- "Digital Health" both become "Healthtech" and cannot be told apart afterwards.
-- Both backup tables below hold the exact prior rows, so a rollback is a restore
-- from them, not a down-migration. See the ROLLBACK note at the foot of the file.

-- 0. Backups. Taken BEFORE anything is rewritten, and deliberately left in place:
--    they are the only record of what each row said before.
create table if not exists public.companies_sector_backup_20260819 as
  select slug, sector from public.companies where sector is not null;

create table if not exists public.profiles_targets_backup_20260819 as
  select id, target_roles, target_sectors from public.profiles;

alter table public.companies_sector_backup_20260819 enable row level security;
alter table public.profiles_targets_backup_20260819 enable row level security;
comment on table public.companies_sector_backup_20260819 is
  'Pre-#70 companies.sector values. Restore source for the sector vocabulary migration; no policies, so only the service role reads it.';
comment on table public.profiles_targets_backup_20260819 is
  'Pre-#70 profiles.target_roles / target_sectors. Restore source for the vocabulary migration; no policies, so only the service role reads it.';

-- 1. The mapping, as a function so the three rewrites below share ONE copy of it.
--    Matching is case- and punctuation-insensitive (the same fold as `tidy` in
--    scripts/sector-lib.mjs), so only genuinely different words need an entry.
--    A canonical name maps to itself; a dropped one maps to null; anything absent
--    returns null, because a wrong industry is worse than none — it files a
--    company behind a chip its roles do not belong to.
--    Dropped at the end of this migration: it exists only to run these updates.
create or replace function public.__sector_vocab_normalize(raw text)
returns text
language sql
immutable
as $fn$
  select m.canonical
  from (values
    ('fintech', 'Fintech'),
    ('wealthtech and insurtech', 'Wealthtech & insurtech'),
    ('ai and machine learning', 'AI & machine learning'),
    ('data and analytics', 'Data & analytics'),
    ('developer tools and infrastructure', 'Developer tools & infrastructure'),
    ('cybersecurity', 'Cybersecurity'),
    ('productivity and collaboration', 'Productivity & collaboration'),
    ('no code and automation', 'No-code & automation'),
    ('sales marketing and cx tech', 'Sales, marketing & CX tech'),
    ('hr tech', 'HR tech'),
    ('legal and compliance tech', 'Legal & compliance tech'),
    ('healthtech', 'Healthtech'),
    ('medtech and devices', 'Medtech & devices'),
    ('biotech', 'Biotech'),
    ('edtech', 'Edtech'),
    ('climate tech', 'Climate tech'),
    ('energy', 'Energy'),
    ('aerospace and defense', 'Aerospace & defense'),
    ('mobility and transport', 'Mobility & transport'),
    ('supply chain and logistics', 'Supply chain & logistics'),
    ('e commerce and retail', 'E-commerce & retail'),
    ('travel and hospitality', 'Travel & hospitality'),
    ('food and agritech', 'Food & agritech'),
    ('real estate and construction tech', 'Real estate & construction tech'),
    ('robotics', 'Robotics'),
    ('hardware iot and industrial', 'Hardware, IoT & industrial'),
    ('media entertainment and gaming', 'Media, entertainment & gaming'),
    ('sports and wellness', 'Sports & wellness'),
    ('insurtech', 'Wealthtech & insurtech'),
    ('ai', 'AI & machine learning'),
    ('data management', 'Data & analytics'),
    ('developer tools', 'Developer tools & infrastructure'),
    ('observability and security', 'Developer tools & infrastructure'),
    ('work management productivity software', 'Productivity & collaboration'),
    ('sales and marketing tech', 'Sales, marketing & CX tech'),
    ('adtech', 'Sales, marketing & CX tech'),
    ('customer service ai', 'Sales, marketing & CX tech'),
    ('audit tech ai', 'Legal & compliance tech'),
    ('health tech', 'Healthtech'),
    ('digital health', 'Healthtech'),
    ('healthcare', 'Healthtech'),
    ('circular economy', 'Climate tech'),
    ('aviation and drones', 'Aerospace & defense'),
    ('aerial data intelligence and unmanned aerial vehicles', 'Aerospace & defense'),
    ('mobility', 'Mobility & transport'),
    ('maritime', 'Mobility & transport'),
    ('supply chain and ops tech', 'Supply chain & logistics'),
    ('logistics', 'Supply chain & logistics'),
    ('e commerce', 'E-commerce & retail'),
    ('e commerce and retail tech', 'E-commerce & retail'),
    ('fashion and retail tech', 'E-commerce & retail'),
    ('hospitality', 'Travel & hospitality'),
    ('food delivery', 'Food & agritech'),
    ('food waste marketplace', 'Food & agritech'),
    ('agritech and foodtech', 'Food & agritech'),
    ('real estate tech', 'Real estate & construction tech'),
    ('construction tech', 'Real estate & construction tech'),
    ('proptech', 'Real estate & construction tech'),
    ('hardware and semiconductors', 'Hardware, IoT & industrial'),
    ('iot and sensors', 'Hardware, IoT & industrial'),
    ('manufacturing and production', 'Hardware, IoT & industrial'),
    ('media and entertainment', 'Media, entertainment & gaming'),
    ('gaming', 'Media, entertainment & gaming'),
    ('social and creator economy', 'Media, entertainment & gaming'),
    ('saas', null),
    ('software saas', null),
    ('enterprise software', null),
    ('ai cx', null)
  ) as m(tidy_key, canonical)
  where m.tidy_key = btrim(regexp_replace(replace(lower(raw), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))
  limit 1
$fn$;

-- 2. Migrate every company onto the canonical vocabulary. A string the map does
--    not know becomes null: it was never a value any picker could offer, so
--    keeping it only kept a company out of every industry the user can choose.
update public.companies
set sector = public.__sector_vocab_normalize(sector)
where sector is not null
  and sector is distinct from public.__sector_vocab_normalize(sector);

-- 3. The users' stored industry targets came from the same catalog strings, so
--    they carry the same variants. Left alone they would match nothing after
--    step 2 and quietly empty that user's scoring slice. Unmappable entries drop
--    out; an empty array reads as "no industry preference", which shows
--    everything — the honest fallback, not an empty page.
update public.profiles p
set target_sectors = coalesce(
  (
    select array_agg(distinct c order by c)
    from unnest(p.target_sectors) as t(v)
    cross join lateral (select public.__sector_vocab_normalize(t.v) as c) n
    where n.c is not null
  ),
  '{}'::text[]
)
where p.target_sectors is not null
  and array_length(p.target_sectors, 1) > 0;

-- 4. The role half of #70. The pickers offered ten Title-Case archetypes while the
--    catalog is labelled with five lowercase `jobs.role_family` values, so the two
--    could not be compared. The families win. Five archetypes mapped 1:1 already;
--    the other five had no family at all, and are placed explicitly here (the same
--    map as FAMILY_BY_ARCHETYPE in src/lib/labels.ts):
--      Growth -> marketing · Data -> engineering · Strategy -> operations ·
--      Founding -> product · Design -> dropped (a deferred vertical with no home).
--    Idempotent: a value already stored as a family maps to itself.
update public.profiles p
set target_roles = coalesce(
  (
    select array_agg(distinct m.family order by m.family)
    from unnest(p.target_roles) as t(v)
    join (values
    ('Product', 'product'),
    ('Engineering', 'engineering'),
    ('Marketing', 'marketing'),
    ('Sales/BD', 'sales'),
    ('Operations', 'operations'),
    ('Growth', 'marketing'),
    ('Data', 'engineering'),
    ('Strategy', 'operations'),
    ('Founding', 'product'),
    ('Product Manager', 'product'),
    ('product', 'product'),
    ('engineering', 'engineering'),
    ('sales', 'sales'),
    ('marketing', 'marketing'),
    ('operations', 'operations')
    ) as m(archetype, family) on m.archetype = t.v
  ),
  '{}'::text[]
)
where p.target_roles is not null
  and array_length(p.target_roles, 1) > 0;

-- 5. Pin it. The scrapers write with the service role, and a CHECK applies to the
--    service role too, so no enrichment run can reintroduce a variant.
alter table public.companies
  add constraint companies_sector_vocabulary
  check (
    sector is null
    or sector = any (array['Fintech','Wealthtech & insurtech','AI & machine learning','Data & analytics','Developer tools & infrastructure','Cybersecurity','Productivity & collaboration','No-code & automation','Sales, marketing & CX tech','HR tech','Legal & compliance tech','Healthtech','Medtech & devices','Biotech','Edtech','Climate tech','Energy','Aerospace & defense','Mobility & transport','Supply chain & logistics','E-commerce & retail','Travel & hospitality','Food & agritech','Real estate & construction tech','Robotics','Hardware, IoT & industrial','Media, entertainment & gaming','Sports & wellness'])
  );

comment on column public.companies.sector is
  'Industry, one of the 28 canonical values in scripts/sector-lib.mjs (SECTORS), or null when no source states one. Writers MUST go through normalizeSector(); the constraint companies_sector_vocabulary is the backstop. CANONICAL IS NOT PICKABLE: which of these a user may CHOOSE is recomputed from live liquidity (>=3 hiring employers AND >=20 live roles) in src/lib/sectors.ts, never stored.';

-- 6. Refresh the jobs.role_family comment. 20260710120000_add_role_family_column.sql
--    still says the values are "e.g. Product Manager, Data, Design" and that
--    "nothing writes it yet" — both untrue since #34, and the null→Product mapping
--    it describes is what #70 removed. That file is already applied, so it is left
--    untouched and the comment is corrected here instead.
comment on column public.jobs.role_family is
  'Role vertical: product | engineering | sales | marketing | operations, written by the scrapers via classifyRoleFamily() in scripts/job-filters.mjs. Null = a deferred vertical the classifier declined to label (design, data analyst/scientist); the client reads null as "Other", NOT as Product.';

-- profiles.target_roles / target_sectors deliberately get NO check constraint. A
-- browser tab still running the previous bundle would fail its write and the user
-- would lose the CV they just pasted; the read-time shims (normalizeTargetRoles /
-- normalizeTargetSectors) translate such a value instead, which costs nothing and
-- strands nobody.

drop function public.__sector_vocab_normalize(text);

-- ROLLBACK (manual)
--   alter table public.companies drop constraint companies_sector_vocabulary;
--   update public.companies c set sector = b.sector
--     from public.companies_sector_backup_20260819 b where b.slug = c.slug;
--   update public.profiles p set target_roles = b.target_roles, target_sectors = b.target_sectors
--     from public.profiles_targets_backup_20260819 b where b.id = p.id;
-- The value rewrites do not reverse on their own: "Healthtech" could have been
-- "Health Tech" or "Digital Health" before this ran. The backup tables are the
-- only way back, which is why they are created first and left in place.
