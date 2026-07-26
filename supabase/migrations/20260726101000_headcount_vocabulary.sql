-- One company-size vocabulary for companies.headcount_bucket (issue #68, item 6).
--
-- The column carried TWO overlapping schemes at once: a LinkedIn-shaped one
-- (1-10 / 11-50 / 51-200 / 201-500 / 500-2k / 2k+) and a career-ops-shaped one
-- (<10 / 10-30 / 30-100 / 100-500 / 500+). They overlap rather than merely
-- differ: an 80-person company was 30-100 or 51-200 purely by which source wrote
-- the row. A 2026-07-26 measurement over the personal engine's golden scoring
-- data found company size bucket alone recovers about 95% of the deterministic
-- ranker's power, so that inconsistency was noise in the strongest signal we have.
--
-- The canonical ladder is contiguous and disjoint — every headcount of 1 or more
-- sits in exactly one rung, none sits in two:
--
--     1-10 · 11-50 · 51-200 · 201-500 · 501-2000 · 2001+
--
-- Four of the six rungs are at or below 500 because the product is about European
-- startups and scale-ups: that is where the ranking decisions happen.
--
-- Rule and code move together: the same list lives in scripts/headcount-lib.mjs
-- (`HEADCOUNT_BUCKETS`), which is the only way any writer may set this column,
-- and src/test/headcount-lib.test.ts fails if this file and that constant drift.
--
-- ⚠️ THIS DATA MIGRATION IS ONE-WAY. Legacy values collapse by midpoint
-- (30-100 → 51-200, 100-500 → 201-500, 10-30 → 11-50, 500+ → 501-2000, <10 →
-- 1-10), so the exact prior token cannot be recovered from the new one. This is
-- the SAME collapse the app already applied at display time (src/lib/roles.ts
-- `sizeBand`, shipped 2026-07-06), so no distinction the product ever made is
-- lost — only the raw token is. See the ROLLBACK note at the foot of this file.

-- 1. Migrate every existing row onto the canonical ladder.
update public.companies
set headcount_bucket = case trim(headcount_bucket)
  -- career-ops-shaped scheme
  when '<10'      then '1-10'
  when '10-30'    then '11-50'
  when '30-100'   then '51-200'
  when '100-500'  then '201-500'
  when '500+'     then '501-2000'
  -- LinkedIn-shaped scheme (the four small rungs keep their tokens)
  when '1-10'     then '1-10'
  when '11-50'    then '11-50'
  when '51-200'   then '51-200'
  when '201-500'  then '201-500'
  when '500-2k'   then '501-2000'
  when '2k+'      then '2001+'
  else headcount_bucket
end
where headcount_bucket is not null;

-- 2. Anything still outside the vocabulary was never readable by the app
--    (src/lib/roles.ts mapped only the tokens above; everything else already
--    rendered as no size and was ignored by the size filter). Null is the honest
--    value for it, and it is what the CHECK below requires.
update public.companies
set headcount_bucket = null
where headcount_bucket is not null
  and headcount_bucket <> all (array['1-10','11-50','51-200','201-500','501-2000','2001+']);

-- 3. Pin it. No source can invent a third scheme: the scrapers write with the
--    service role, and this constraint applies to the service role too.
alter table public.companies
  add constraint companies_headcount_bucket_vocabulary
  check (
    headcount_bucket is null
    or headcount_bucket = any (array['1-10','11-50','51-200','201-500','501-2000','2001+'])
  );

comment on column public.companies.headcount_bucket is
  'Company size, one of 1-10 / 11-50 / 51-200 / 201-500 / 501-2000 / 2001+, or null when no honest source states it. Contiguous and disjoint. Writers MUST go through normalizeHeadcountBucket() in scripts/headcount-lib.mjs; the constraint companies_headcount_bucket_vocabulary is the backstop.';

-- ROLLBACK (manual, and only partly possible)
--   alter table public.companies drop constraint companies_headcount_bucket_vocabulary;
-- The constraint drops cleanly. The VALUE rewrite in step 1 does not reverse:
-- 51-200 could have been 30-100 or 51-200 before this ran, and 501-2000 could
-- have been 500+ or 500-2k. Restoring the exact prior tokens needs a backup from
-- before this migration, not a down-migration.
