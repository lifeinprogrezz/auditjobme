-- Security-advisor hardening — applied 2026-06-14 (Plan 2 follow-up).
-- Reviewed in planning docs/specs/2026-06-14-security-advisor-hardening-review.md.
-- Clears 3 Supabase security-advisor findings. The remaining findings are intentional
-- (public_profiles SECURITY DEFINER view = the deliberate public window for published-audit
-- authors; count_audits_by_fingerprint / generate_audit_slug / get_global_avg_duration are
-- anon-callable by design) or a dashboard toggle (leaked-password protection).

-- 1. handle_new_user is the on-signup trigger; it never needs to be a public RPC.
--    Triggers run as the table owner regardless of EXECUTE grants, so the signup trigger keeps
--    working (verified transactionally: a fresh auth.users insert still creates a profile).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 2. "Anyone can view PDFs" gave the public role a broad SELECT on every audit-pdfs object,
--    enabling enumeration. audit-pdfs is a public bucket, so public object-URL access does NOT
--    depend on this policy; dropping it removes listing without breaking downloads.
drop policy "Anyone can view PDFs" on storage.objects;
