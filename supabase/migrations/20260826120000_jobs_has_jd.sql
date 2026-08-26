-- Issue #130: only roles we can actually read get a score.
--
-- Measured on production (12,623 scores): roles with an empty jd_text scored >= 4.0
-- at 6.0% versus 1.8% for roles with a JD. An empty JD holds nothing that can
-- disqualify a CV, so the least-examined roles floated to the top of the map.
--
-- The paid paths that decide what to score (api/score-backlog.ts) and the client
-- that decides what "still scoring" means (src/hooks/useRolesData.ts, through the
-- daily dataplane artifact) deliberately do NOT fetch jd_text: it is multi-KB per
-- row over an ~8K-row catalog. This generated column is the one-byte stand-in
-- they read instead, so the rule can be applied before any spend without moving
-- the body around. Predicate: src/lib/scorePrefilter.ts hasReadableJd, pinned by
-- src/test/score-prefilter.test.ts.
--
-- Apply BEFORE deploying the code that selects it: a select on a missing column
-- fails the backlog worker closed (nothing is bought), which is the safe side.

alter table public.jobs
  add column if not exists has_jd boolean
  generated always as (jd_text is not null and btrim(jd_text) <> '') stored;

comment on column public.jobs.has_jd is
  'Generated: true when jd_text has non-blank text. A role without one is never scored (issue #130, hasReadableJd).';
