import { describe, it, expect, afterAll } from "vitest";
import * as Sentry from "@sentry/node";
import { sanitizeApiEvent } from "./apiSentry";
import { sanitizeSentryBreadcrumb } from "./sentry-sanitize";

/**
 * apiSentry.test.ts pins the wrapper against a mock. This one drives the REAL
 * @sentry/node with the options initApiSentry uses (tracing off, OpenTelemetry
 * setup skipped — the ESM loader hook it wants does not run on Vercel) and a fake
 * transport, so an option the installed SDK rejects, or a hook that never runs,
 * fails here instead of in production.
 */
describe("@sentry/node wiring", () => {
  afterAll(async () => {
    await Sentry.close(2000);
  });

  it("routes a captured error through the sanitizer and onto the transport", async () => {
    const envelopes: unknown[] = [];
    Sentry.init({
      dsn: ["https://", "examplepublickey", "@o0.ingest.sentry.io/0"].join(""),
      tracesSampleRate: 0,
      skipOpenTelemetrySetup: true,
      sendDefaultPii: false,
      environment: "test",
      initialScope: { tags: { function: "nightly" } },
      beforeSend: sanitizeApiEvent,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
      transport: () => ({
        send: async (envelope: unknown) => {
          envelopes.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });

    // Assembled at runtime: the SDK's ContextLines integration ships the source
    // lines around the throw site, so a literal here would show up on the wire
    // through that path and fake a leak.
    const cvText = ["se", "cret", "-cv-", "body"].join("");
    const email = ["someone", "@", "example", ".com"].join("");
    Sentry.setContext("run", { users: 2, cv_text: cvText, contact: email });
    Sentry.captureException(new Error(`boom for ${email}`));
    await Sentry.flush(2000);

    expect(envelopes.length).toBeGreaterThan(0);
    const wire = JSON.stringify(envelopes);
    expect(wire).toContain("boom for");
    expect(wire).toContain('"function":"nightly"');
    expect(wire).toContain('"users":2');
    expect(wire).not.toContain(cvText);
    expect(wire).not.toContain(email);
  });
});
