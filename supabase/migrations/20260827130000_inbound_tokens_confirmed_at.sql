-- Issue #157 / LOCKED decision 7 (2026-08-26, planning repo spec
-- 2026-08-26-stranger-run-feedback-answers.md item E7): Gmail forwarding now
-- auto-confirms. api/inbound-email.ts follows the extracted /mail/vf-... confirm
-- link server-side (never the /mail/uf- cancel link one letter away, guarded by
-- isConfirmUrl in src/lib/inbound.ts) and stamps this column on success. Settings
-- reads it to show "Confirmed" in the live status line; a null value keeps the
-- manual "Confirm forwarding in Gmail" button as the fallback, exactly as before.
--
-- Separate from gmail_confirmation_at (20260819150000), which stamps when the
-- confirmation MAIL arrived, not when the link was actually followed.
alter table public.inbound_tokens
  add column if not exists gmail_confirmed_at timestamptz;

comment on column public.inbound_tokens.gmail_confirmed_at is
  'When api/inbound-email.ts successfully followed the Gmail /mail/vf- confirm link server-side (issue #157). NULL = not yet confirmed (or confirmed only via the manual button, which does not write this column). Settings shows "Confirmed" once set.';
