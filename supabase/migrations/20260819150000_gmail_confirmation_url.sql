-- Gmail's forwarding confirmation is a LINK, not a code (measured 2026-08-19
-- against a real confirmation mail: the subject carries no code at all and the
-- body carries a clickable https://mail.google.com/mail/vf-... link). The
-- existing gmail_confirmation_code column can only ever hold the older
-- "(#123456789)" format, so it stays for those accounts rather than being
-- overloaded with a URL and made to lie about what it holds.
alter table public.inbound_tokens
  add column if not exists gmail_confirmation_url text;

comment on column public.inbound_tokens.gmail_confirmation_url is
  'The https://mail.google.com/mail/vf-... link from Gmail''s forwarding confirmation, written by api/inbound-email.ts. Settings shows it as a button the user clicks. Never the /mail/uf- link in the same mail, which CANCELS the request.';
