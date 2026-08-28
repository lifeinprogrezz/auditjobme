// Issue #75 — the Settings surface for inbox auto-advance (Option A: forwarding
// address). Shows the user's personal `u-{token}@northgoing.com` address and the
// one guided Gmail filter that makes their tracker move itself. Reads the own token
// row through row-level security; creation goes through the server-side
// get_or_create_forwarding_token() function, so a client can never choose a token.
// The Gmail forwarding-verification link Google mails TO the address is parsed by
// the inbound endpoint onto the token row, which also follows it server-side
// (issue #157 / LOCKED decision 7) — this section just reflects the result back as
// a live status line, polling its own row every 10s until it reads confirmed.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ATS_SENDER_DOMAINS, forwardingAddress, forwardingStatus, type ForwardingStatus } from "@/lib/inbound";

// inbound_tokens is not in the generated types until the migration is applied to the
// project and src/integrations/supabase/types.ts is regenerated (same note as
// delete_own_account in Settings.tsx).
type TokenRow = {
  token: string;
  gmail_confirmation_code: string | null;
  gmail_confirmation_url: string | null;
  gmail_confirmation_at: string | null;
  gmail_confirmed_at: string | null;
};
type InboundClient = {
  from: (table: string) => {
    select: (cols: string) => { limit: (n: number) => Promise<{ data: TokenRow[] | null; error: unknown }> };
  };
  rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as InboundClient;

const POLL_MS = 10_000;
// Auto-confirm is a single server-side fetch and normally lands within seconds;
// 60s is generous slack before Settings offers the manual fallback, so a slow
// Gmail response doesn't flash the button and then take it away again.
const MANUAL_FALLBACK_DELAY_MS = 60_000;

const STATUS_STEPS: { key: ForwardingStatus; label: string }[] = [
  { key: "created", label: "Address created" },
  { key: "received", label: "Confirmation received" },
  { key: "confirmed", label: "Confirmed" },
];
const STATUS_ORDER: ForwardingStatus[] = ["none", "created", "received", "confirmed"];

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
    const { data } = await db
      .from("inbound_tokens")
      .select("token, gmail_confirmation_code, gmail_confirmation_url, gmail_confirmation_at, gmail_confirmed_at")
      .limit(1);
    setRow(data?.[0] ?? null);
    setChecked(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const status = forwardingStatus(row);

  // Auto-confirm runs server-side (issue #157); this poll is what picks the
  // result up without the user coming back to click Refresh themselves. Stops
  // as soon as the row reads confirmed.
  useEffect(() => {
    if (!row || status === "confirmed") return;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [row, status, load]);

  const showManualFallback =
    status === "received" &&
    row?.gmail_confirmation_at != null &&
    Date.now() - new Date(row.gmail_confirmation_at).getTime() > MANUAL_FALLBACK_DELAY_MS;

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
        Forward the emails your applications generate here, just the ones you choose, and your board updates on its
        own.
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

          <p className="mt-2 text-caption text-muted-foreground" role="status">
            {STATUS_STEPS.map((step, i) => (
              <span
                key={step.key}
                className={STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(step.key) ? "font-medium text-foreground" : ""}
              >
                {i > 0 && " · "}
                {step.label}
              </span>
            ))}
          </p>

          {showManualFallback &&
            (row.gmail_confirmation_url ? (
              <a
                className="mt-3 inline-flex items-center rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                href={row.gmail_confirmation_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Confirm forwarding in Gmail
              </a>
            ) : row.gmail_confirmation_code ? (
              <p className="mt-3 text-caption text-foreground">
                Your code: <code>{row.gmail_confirmation_code}</code>
              </p>
            ) : null)}

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-body text-muted-foreground">
            <li>Add this address as a forwarding address in Gmail, under Settings, then "Forwarding and POP/IMAP".</li>
            {/* Rober, setting it up himself 2026-08-28: the confirmation takes about
                two minutes, and with no step for it the page looked stuck between
                adding the address and building the filter. Gmail emails us a
                confirmation link and the server presses it (issue #185); the status
                line above turns green on its own. */}
            <li>Wait about two minutes. Gmail sends a confirmation and we accept it for you. Nothing to click.</li>
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
            This covers the applicant tracking systems we recognize, and moves your card to confirmed, interview, or
            rejected on its own.
          </p>
        </>
      )}
    </section>
  );
}
