// Issue #78 — the Settings surface for referral attribution: a "Your invite link"
// line with a copy button. The token is minted by the server-side
// get_or_create_referral_token() function (idempotent, so calling it on every visit
// is safe and free) — a client can never choose a token, and the attribution row a
// link produces is written only by the server-side claim (see the #78 migration).
// Issue #160 adds the honest perk (queue priority, zero cost — the money reward
// stays blocked on #35) and the "N people joined through you" count, read via
// my_referral_count() (supabase/migrations/20260827140000_referral_count_rpc.sql).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { DEV_FIXTURE, DEV_FIXTURE_REFERRAL_TOKEN, DEV_FIXTURE_REFERRAL_COUNT } from "@/lib/devFixture";
import { formatReferralCount, inviteLink, isMissingReferralCountFn } from "@/lib/referral";

// get_or_create_referral_token / my_referral_count are not in the generated types
// until their migrations are applied and src/integrations/supabase/types.ts is
// regenerated (same note as delete_own_account in Settings.tsx).
type ReferralClient = {
  rpc: (fn: string) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};
const db = supabase as unknown as ReferralClient;

export default function ReferralSection() {
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dev-only (lib/devFixture.ts): the E2E-bypass mock user carries no JWT, so the
    // RLS-guarded mint answers 401 and this section shows its failed state on every
    // walk of /settings. Show a synthetic link + count instead. `import.meta.env.DEV`
    // is a literal false in a production build, so this branch folds away there.
    if (DEV_FIXTURE) {
      setLink(inviteLink(DEV_FIXTURE_REFERRAL_TOKEN));
      setCount(DEV_FIXTURE_REFERRAL_COUNT);
      return;
    }
    void db.rpc("get_or_create_referral_token").then(({ data, error }) => {
      if (cancelled) return;
      if (error || typeof data !== "string" || data.length === 0) {
        if (error) console.error("referral token fetch failed", error);
        setFailed(true);
      } else {
        setLink(inviteLink(data));
      }
    });
    // my_referral_count is a nicety, not the invite link itself — a missing
    // migration or any other failure just hides the count (isMissingReferralCountFn
    // covers the expected case; any other error also degrades to hidden, since
    // showing nothing is safer than showing a wrong number).
    void db.rpc("my_referral_count").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        if (!isMissingReferralCountFn(error)) console.error("referral count fetch failed", error);
        setCount(null);
        return;
      }
      const n = typeof data === "number" ? data : Number(data);
      setCount(Number.isFinite(n) ? n : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const countLine = formatReferralCount(count);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-page">
      <h2 className="font-display text-section text-foreground">Your invite link</h2>
      <p className="mt-3 text-body text-muted-foreground text-pretty">
        Know someone job-hunting? Share your personal link and we'll know they came through you.
        People who join through your link get scored first.
      </p>
      {countLine && <p className="mt-1 text-sm text-muted-foreground">{countLine}</p>}
      {link ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="rounded-md bg-muted px-3 py-1.5 text-sm text-foreground break-all">{link}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {failed ? "Couldn't load your link just now. Reload the page to try again." : "Loading your link…"}
        </p>
      )}
    </section>
  );
}
