-- The $300 fail-closed cap could not see money spent on the "Draft answer" feature.
--
-- The proxy's ALLOWED_KINDS gained 'answer' when that feature shipped (src/lib/tailor.ts
-- -> callProxy(..., "answer"), the button in src/pages/Apply.tsx). The CHECK constraint on
-- usage_events never did. So every answer draft was billed by Anthropic and then rejected
-- on the way into the meter — silently, because supabase-js RETURNS errors rather than
-- throwing, so the try/catch around the insert never fired and the returned error was
-- never read.
--
-- global_month_spend_usd() sums usage_events. A kind missing from this constraint is a
-- kind the cap cannot count. Same shape as the truncated-ledger bug: there the cap read
-- 1000 of 12,000 rows; here it reads none of a whole category.
--
-- Measured before this migration: usage_events held score/extract/enrich/audit/cv/letter
-- and ZERO 'answer' rows, while cv (5) and letter (3) — the sibling buttons on the same
-- page, through the same proxy call — recorded fine.
--
-- Pinned by src/test/usage-kind-parity.test.ts, which fails CI if the proxy ever meters a
-- kind this constraint does not accept.

alter table public.usage_events drop constraint usage_events_kind_check;

alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('score', 'audit', 'cv', 'letter', 'extract', 'enrich', 'answer'));

comment on constraint usage_events_kind_check on public.usage_events is
  'Accepted metering kinds. MUST be a superset of ALLOWED_KINDS in supabase/functions/anthropic-proxy/index.ts: a kind the proxy meters but this rejects is spend the $300 cap cannot see. Enforced by src/test/usage-kind-parity.test.ts.';
