// Issue #75 — the Settings surface for inbox auto-advance (Option A: forwarding
// address). Shows the user's personal `u-{token}@track.northgoing.com` address and the
// one guided Gmail filter that makes their tracker move itself. Reads the own token
// row through row-level security; creation goes through the server-side
// get_or_create_forwarding_token() function, so a client can never choose a token.
// The Gmail forwarding-verification code Google mails TO the address is parsed by
// the inbound endpoint onto the token row, and surfaces here.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ATS_SENDER_DOMAINS, forwardingAddress } from "@/lib/inbound";

// inbound_tokens is not in the generated types until the migration is applied to the
// project and src/integrations/supabase/types.ts is regenerated (same note as
// delete_own_account in Settings.tsx).
type TokenRow = { token: string; gmail_confirmation_code: string | null };
type InboundClient = {
  from: (table: string) => {
    select: (cols: string) => { limit: (n: number) => Promise<{ data: TokenRow[] | null; error: unknown }> };
  };
  rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as InboundClient;

/** The one Gmail filter, as a copyable From: query over every sender we parse. */
const GMAIL_FILTER_QUERY = [...new Set(ATS_SENDER_DOMAINS.map(([suffix]) => suffix))].join(" OR ");

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

export default function ForwardingSection() {
  const [row, setRow] = useState<TokenRow | null>(null);
  const [checked, setChecked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data } = await db.from("inbound_tokens").select("token, gmail_confirmation_code").limit(1);
    setRow(data?.[0] ?? null);
    setChecked(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setFailed(false);
    const { error } = await db.rpc("get_or_create_forwarding_token");
    if (error) {
      console.error("forwarding token creation failed", error);
      setFailed(true);
    } else {
      await load();
    }
    setCreating(false);
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-page">
      <h2 className="font-display text-section text-foreground">Email auto-tracking</h2>
      <p className="mt-3 text-body text-muted-foreground text-pretty">
        Job applications generate email: a confirmation when you apply, an interview invite when it goes well, a
        rejection when it doesn't. Forward those to your personal tracking address and your board moves itself. One
        Gmail filter, set up once. We only ever see the mail you choose to forward, never your inbox.
      </p>

      {!checked ? (
        <p className="mt-4 text-caption text-muted-foreground" role="status">
          Checking…
        </p>
      ) : !row ? (
        <>
          <Button variant="outline" className="mt-4" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating your address…" : "Create my tracking address"}
          </Button>
          {failed && (
            <p className="mt-3 text-caption text-muted-foreground" role="alert">
              We couldn't create your address just now. Give it another try in a moment.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="rounded-[10px] border border-border bg-background px-3 py-2 text-caption text-foreground break-all">
              {forwardingAddress(row.token)}
            </code>
            <CopyButton text={forwardingAddress(row.token)} label="Copy address" />
          </div>

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-body text-muted-foreground">
            <li>
              In Gmail, open Settings, then "Forwarding and POP/IMAP", and add the address above as a forwarding
              address. Gmail will ask for a verification code.
            </li>
            <li>
              The code arrives here, not in your inbox: refresh below and it will show up.
              {row.gmail_confirmation_code ? (
                <span className="ml-1 font-medium text-foreground">
                  Your code: <code>{row.gmail_confirmation_code}</code>
                </span>
              ) : (
                <Button variant="ghost" size="sm" className="ml-2" onClick={() => void load()}>
                  Refresh for code
                </Button>
              )}
            </li>
            <li>
              Create one filter: in the Gmail search bar, open filter options, paste the sender list below into the
              "From" field, choose "Create filter", and tick "Forward it" to your tracking address.
            </li>
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="max-w-full overflow-x-auto rounded-[10px] border border-border bg-background px-3 py-2 text-caption text-muted-foreground">
              {GMAIL_FILTER_QUERY}
            </code>
            <CopyButton text={GMAIL_FILTER_QUERY} label="Copy sender list" />
          </div>

          <p className="mt-3 text-caption text-muted-foreground text-pretty">
            That list covers the common applicant tracking systems (Greenhouse, Lever, Ashby and friends). Mail from
            them moves your card: a confirmation stamps it confirmed, an interview invite moves it to Interview, a
            rejection closes it. An old rejection never overwrites a later interview.
          </p>
        </>
      )}
    </section>
  );
}
