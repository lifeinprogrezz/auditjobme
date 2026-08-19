// Pins Svix webhook verification (#118). Resend signs inbound webhooks with Svix
// headers, not the shared bearer secret api/inbound-email.ts was built for, so
// this is the only thing standing between "anyone can POST a fake job rejection
// into a user's tracker" and a real trust boundary.
//
// The round-trip tests sign with the same algorithm they verify, which is
// circular on its own: get the format wrong in both directions and they still
// agree. So the signed-content FORMAT is pinned separately against the values in
// Svix's documented example. The example's expected signature is not reproduced,
// because matching it needs Svix's sample secret committed here, and a
// realistic-looking key in a test file is how a real one eventually lands beside
// it — the fixture is deliberately low-entropy and readable instead.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SVIX_TOLERANCE_SEC, svixSignedContent, verifySvixSignature } from "@/lib/svix";

// Base64 of the literal phrase "not-a-real-secret". Deliberately low-entropy and
// readable: a realistic-looking key here trips the CI secrets scan, and the scan
// is right to be suspicious rather than taught to ignore this shape.
const SECRET = "whsec_" + Buffer.from("not-a-real-secret").toString("base64");

/** Sign exactly as Svix documents: HMAC-SHA256 over `${id}.${timestamp}.${body}`. */
function sign(id: string, ts: number, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.split("_")[1], "base64");
  return createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

const NOW = 1_700_000_000;
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const BODY = '{"type":"email.received","data":{"email_id":"abc"}}';

const headers = (over: Partial<{ id: string; ts: number; sig: string }> = {}) => ({
  id: over.id ?? ID,
  timestamp: String(over.ts ?? NOW),
  signature: over.sig ?? `v1,${sign(over.id ?? ID, over.ts ?? NOW, BODY)}`,
});

describe("verifySvixSignature", () => {
  it("accepts a correctly signed request", () => {
    expect(verifySvixSignature({ ...headers(), rawBody: BODY, secret: SECRET, nowSec: NOW })).toBeNull();
  });

  it("builds the exact signed content Svix documents, separators and order included", () => {
    // Pinned to the values in Svix's manual-verification example. This is the one
    // thing a round trip cannot catch: sign and verify with the same wrong format
    // and both agree. The example's expected SIGNATURE is deliberately not
    // reproduced here, because doing so would require Svix's sample secret in the
    // repo, and a realistic-looking key in a test is how a real one eventually
    // gets committed next to it.
    expect(svixSignedContent("msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}')).toBe(
      'msg_p5jXN8AQM9LWM0D4loKWxJek.1614265330.{"test": 2432232314}',
    );
  });

  it("rejects a body altered after signing — the whole point of the check", () => {
    const h = headers();
    const tampered = BODY.replace("abc", "xyz");
    expect(verifySvixSignature({ ...h, rawBody: tampered, secret: SECRET, nowSec: NOW })?.status).toBe(401);
  });

  it("rejects a signature made with a different secret", () => {
    const h = { ...headers(), signature: `v1,${sign(ID, NOW, BODY, "whsec_" + Buffer.from("other-secret").toString("base64"))}` };
    expect(verifySvixSignature({ ...h, rawBody: BODY, secret: SECRET, nowSec: NOW })?.status).toBe(401);
  });

  it("rejects a replayed request outside the tolerance window", () => {
    const old = NOW - SVIX_TOLERANCE_SEC - 1;
    const h = headers({ ts: old });
    // The signature itself is valid; only the age disqualifies it.
    expect(verifySvixSignature({ ...h, rawBody: BODY, secret: SECRET, nowSec: NOW })?.status).toBe(401);
  });

  it("rejects a timestamp from the future beyond tolerance (clock-skew abuse)", () => {
    const future = NOW + SVIX_TOLERANCE_SEC + 1;
    const h = headers({ ts: future });
    expect(verifySvixSignature({ ...h, rawBody: BODY, secret: SECRET, nowSec: NOW })?.status).toBe(401);
  });

  it("accepts when one of several space-delimited signatures matches", () => {
    // Svix sends every valid signature during a secret rotation.
    const h = headers();
    const many = `v1,ZmFrZQ== ${h.signature}`;
    expect(verifySvixSignature({ ...h, signature: many, rawBody: BODY, secret: SECRET, nowSec: NOW })).toBeNull();
  });

  it("ignores versions it does not understand rather than trusting them", () => {
    const h = headers();
    const v2only = `v2,${sign(ID, NOW, BODY)}`;
    expect(verifySvixSignature({ ...h, signature: v2only, rawBody: BODY, secret: SECRET, nowSec: NOW })?.status).toBe(401);
  });

  it("fails closed on missing headers or an unconfigured secret", () => {
    expect(verifySvixSignature({ id: "", timestamp: "", signature: "", rawBody: BODY, secret: SECRET, nowSec: NOW })?.status).toBe(401);
    expect(verifySvixSignature({ ...headers(), rawBody: BODY, secret: undefined, nowSec: NOW })?.status).toBe(500);
  });
});
