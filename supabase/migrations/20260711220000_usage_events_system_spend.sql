-- Track D S10 (2026-07-11): the two CI enrichment passes (scripts/extract-jd.mjs,
-- scripts/enrich-companies.mjs) spend on the raw Anthropic key OUTSIDE the proxy,
-- so their cost was invisible to usage_events — the one ledger a launch-time cap
-- will read. They are system spend with no user, so:
--   * user_id becomes nullable (NULL = system/CI spend, not tied to any account)
--   * kind gains 'extract' + 'enrich'
-- The write path stays service-role-only (locked 20260615120000) and the
-- "read own usage" policy never matches NULL-user rows, so users see nothing new.
alter table public.usage_events alter column user_id drop not null;

alter table public.usage_events drop constraint usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('score', 'audit', 'cv', 'letter', 'extract', 'enrich'));
