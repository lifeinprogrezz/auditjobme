-- Issue #76: per-role "anything specific for this one?" note on the Apply page.
-- Additive, nullable column on the artifact row (cv | letter | answers) — never
-- on profiles. That's the whole point: it's per-application, not a general
-- "about you" side-channel (that idea was considered and CUT, Rober 7-26).
alter table public.artifacts
  add column if not exists context text;

comment on column public.artifacts.context is 'Optional per-role note from the candidate (why this company, a referral, a hook) — issue #76. Feeds tailor.ts prompts for THIS role''s summary/cover/answers only; the model may use it, never invent beyond it. Empty/absent = no change to generated output.';
