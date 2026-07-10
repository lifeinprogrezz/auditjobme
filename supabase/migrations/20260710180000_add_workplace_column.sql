-- Workplace mode (remote | hybrid | onsite) for the headbar Workplace facet.
-- SCRAPE-OWNED: computed by scripts/workplace-lib.mjs (structured ATS field ??
-- location-string heuristic ?? JD-text heuristic) and refreshed by the nightly
-- upsert. Distinct from extraction.remote_policy (JD-only, owned by extract-jd);
-- the client reads workplace ?? extraction.remote_policy ?? remote-flag.
-- Nullable, no default — null = honestly unknown (no structured/location/JD signal).
-- Spec: planning repo docs/specs/2026-07-10-headbar-role-facet-design.md (addendum)
alter table public.jobs add column if not exists workplace text;

comment on column public.jobs.workplace is
  'Workplace mode: remote | hybrid | onsite. Scrape-owned (workplace-lib.mjs: structured ATS field ?? location ?? JD heuristic), refreshed nightly. Null = unknown. Client falls back to extraction.remote_policy, then the remote flag.';
