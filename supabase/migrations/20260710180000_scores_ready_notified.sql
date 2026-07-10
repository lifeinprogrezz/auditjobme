-- Server-side scoring backlog (issue #33): the exactly-once stamp for the
-- "your roles are scored" email. NULL = a pass is (or may be) in flight and the
-- completion email hasn't been sent; the backlog worker stamps it when a user's
-- last unscored live role is scored AND the email send succeeded. The client CV
-- -change path nulls it (alongside its existing scores delete) so a new CV
-- starts a new pass and earns a new email.
-- Spec: planning repo docs/specs/2026-07-10-server-side-scoring-backlog-design.md
alter table public.profiles add column if not exists scores_ready_notified_at timestamptz;

comment on column public.profiles.scores_ready_notified_at is
  'When the "your roles are scored" completion email was sent for the current scoring pass. Null = pass in flight / not yet notified. Reset to null on CV change (new pass).';
