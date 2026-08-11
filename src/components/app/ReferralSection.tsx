// Issue #78 — the Settings surface for referral attribution: a "Your invite link"
// line with a copy button, nothing more (the reward half is blocked on #35 and has
// no surface here). The token is minted by the server-side
// get_or_create_referral_token() function (idempotent, so calling it on every visit
// is safe and free) — a client can never choose a token, and the attribution row a
// link produces is written only by the server-side claim (see the #78 migration).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { inviteLink } from "@/lib/referral";

// get_or_create_referral_token is not in the generated types until the migration is
// applied and src/integrations/supabase/types.ts is regenerated (same note as
// delete_own_account in Settings.tsx).
type ReferralClient = {
  rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as ReferralClient;

export default function ReferralSection() {
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void db.rpc("get_or_create_referral_token").then(({ data, error }) => {
      if (cancelled) return;
      if (error || typeof data !== "string" || data.length === 0) {
        if (error) console.error("referral token fetch failed", error);
        setFailed(true);
      } else {
        setLink(inviteLink(data));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-page">
      <h2 className="font-display text-section text-foreground">Your invite link</h2>
      <p className="mt-3 text-body text-muted-foreground text-pretty">
        Know someone job-hunting? Share your personal link and we'll know they came through you.
      </p>
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
