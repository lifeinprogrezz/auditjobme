// Svix webhook signature verification (#118). Resend signs inbound-email webhooks
// with Svix, not with the shared bearer secret api/inbound-email.ts was originally
// built for, so this is the trust boundary on that endpoint: without it anyone who
// learns the URL can POST a fabricated "you were rejected" into a user's tracker.
//
// SERVER ONLY. It imports node:crypto, so it must never be pulled into the client
// bundle — keep it out of src/lib/inbound.ts, which ForwardingSection imports.
// api/ reaches it with an extensioned specifier (pinned by api-esm-imports.test.ts).
//
// Algorithm, per Svix's manual-verification documentation:
//   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
//   signature      = base64( HMAC-SHA256( base64decode(secret after "whsec_"), content ) )
//   header         = space-delimited `v{n},{signature}` pairs (several during rotation)
// Pinned by src/test/svix.test.ts, including Svix's own published vector so our
// construction cannot quietly drift from theirs.
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far a webhook's timestamp may sit from now. Svix's own recommendation. */
export const SVIX_TOLERANCE_SEC = 5 * 60;

export type SvixInput = {
  id: string | undefined | null;
  timestamp: string | undefined | null;
  signature: string | undefined | null;
  /** The RAW request body. A re-serialised object will not verify. */
  rawBody: string;
  secret: string | undefined | null;
  nowSec: number;
};

/**
 * The exact string Svix signs: `${id}.${timestamp}.${body}`. Exported so a test can
 * pin the FORMAT against Svix's documented example without needing a secret in the
 * repo. This is the part that can silently drift (a missing separator, a swapped
 * order) while every round-trip test still passes, because a round trip only ever
 * proves we agree with ourselves.
 */
export function svixSignedContent(id: string, timestamp: string | number, rawBody: string): string {
  return `${id}.${timestamp}.${rawBody}`;
}

/** Constant-time compare that cannot throw on a length mismatch. */
function sameSignature(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Null when the request is authentic. Otherwise the status and message to return.
 * Fails CLOSED on every ambiguity: a missing header, an unparseable timestamp, an
 * unknown signature version, or an unconfigured secret are all rejections, because
 * the only thing worse than dropping a real webhook is accepting a forged one.
 */
export function verifySvixSignature(input: SvixInput): { status: number; error: string } | null {
  const { id, timestamp, signature, rawBody, secret, nowSec } = input;
  if (!secret) return { status: 500, error: "RESEND_WEBHOOK_SECRET not configured" };
  if (!id || !timestamp || !signature) return { status: 401, error: "Missing Svix headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { status: 401, error: "Bad Svix timestamp" };
  // Guards replay in both directions: an intercepted old request, and one dated
  // forward to keep itself valid indefinitely.
  if (Math.abs(nowSec - ts) > SVIX_TOLERANCE_SEC) return { status: 401, error: "Svix timestamp outside tolerance" };

  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return { status: 500, error: "RESEND_WEBHOOK_SECRET is not base64" };
  }
  const expected = createHmac("sha256", key).update(svixSignedContent(id, ts, rawBody)).digest("base64");

  // Several signatures arrive during a secret rotation; any v1 match authenticates.
  // Versions we do not implement are ignored rather than trusted.
  const presented = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice("v1,".length));

  if (presented.length === 0) return { status: 401, error: "No v1 signature present" };
  return presented.some((sig) => sameSignature(sig, expected))
    ? null
    : { status: 401, error: "Svix signature mismatch" };
}
