import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Breadcrumb, ErrorEvent as SentryErrorEvent } from "@sentry/react";
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from "./sentry-sanitize";

// Inert stand-ins, assembled at runtime rather than written as single literals: a
// literal `header.payload.signature` string trips the repo's own gitleaks CI rule,
// and this fixture must not cost the next person an allowlist entry. Same shape the
// analytics half of this leak is pinned with (see analytics-sanitize.test.ts).
const FAKE_JWT = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "notARealSignature"].join(".");
const FAKE_GOOGLE_TOKEN = ["ya29", "a0AfB_byC3xample"].join(".");
const OPAQUE_VALUE = "zt5q4h2wnbkd";

/** The fragment Supabase's implicit flow leaves in the address bar after Google sign-in. */
const LEAKED_FRAGMENT =
  `#access_token=${FAKE_JWT}` +
  `&expires_at=1785093815&expires_in=3600&provider_token=${FAKE_GOOGLE_TOKEN}` +
  `&refresh_token=${OPAQUE_VALUE}&token_type=bearer`;

const LEAKED_URL = `https://auditjob.me/${LEAKED_FRAGMENT}`;
/** What Sentry's Breadcrumbs integration stores: parseUrl(...).relative = path + query + fragment. */
const LEAKED_RELATIVE = `/${LEAKED_FRAGMENT}`;

/** Anything that would be a finding if it showed up in a third-party error store. */
const CREDENTIAL_MARKERS = [
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "id_token",
  "token_type",
  "expires_at",
  "expires_in",
  "eyJhbGciOiJIUzI1NiIs", // JWT header
  "ya29.", // Google OAuth token prefix
  OPAQUE_VALUE,
];

/** `ErrorEvent` requires an explicit `type: undefined`; fixtures only set what matters. */
function errorEvent(fields: Record<string, unknown>): SentryErrorEvent {
  return { type: undefined, ...fields } as SentryErrorEvent;
}

function expectNoCredentials(value: unknown) {
  const serialized = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  for (const marker of CREDENTIAL_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
}

describe("sanitizeSentryEvent", () => {
  it("scrubs the HttpContext copy of the sign-in URL off event.request", () => {
    const event = sanitizeSentryEvent(
      errorEvent({
        request: {
          url: LEAKED_URL,
          headers: {
            Referer: LEAKED_URL,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)",
          },
        },
        exception: {
          values: [{ type: "TypeError", value: "cannot read properties of null" }],
        },
      }),
    );

    expectNoCredentials(event);
    expect(event?.request?.url).toBe("https://auditjob.me/");
    expect(event?.request?.headers?.Referer).toBe("https://auditjob.me/");
    // Everything else on the request survives untouched.
    expect(event?.request?.headers?.["User-Agent"]).toBe("Mozilla/5.0 (X11; Linux x86_64)");
  });

  it("scrubs the navigation breadcrumbs riding on the event", () => {
    const event = sanitizeSentryEvent(
      errorEvent({
        breadcrumbs: [
          {
            category: "navigation",
            data: { from: LEAKED_RELATIVE, to: "/roles" },
          },
          {
            category: "navigation",
            data: { from: "/roles", to: LEAKED_RELATIVE },
          },
        ],
      }),
    );

    expectNoCredentials(event);
    expect(event?.breadcrumbs?.[0]?.data).toEqual({ from: "/", to: "/roles" });
    expect(event?.breadcrumbs?.[1]?.data).toEqual({ from: "/roles", to: "/" });
  });

  it("scrubs the open bags a URL can reach: extra, contexts, tags, transaction, message", () => {
    const event = sanitizeSentryEvent(
      errorEvent({
        transaction: LEAKED_URL,
        message: `navigation failed for ${LEAKED_URL}`,
        extra: { attemptedUrl: LEAKED_URL, retries: 2 },
        contexts: {
          app: { app_start_url: LEAKED_URL, app_name: "auditjob.me" },
        },
        tags: { entry_url: LEAKED_URL, route: "roles" },
      }),
    );

    expectNoCredentials(event);
    expect(event?.transaction).toBe("https://auditjob.me/");
    expect(event?.extra?.attemptedUrl).toBe("https://auditjob.me/");
    expect(event?.extra?.retries).toBe(2);
    expect(event?.contexts?.app?.app_start_url).toBe("https://auditjob.me/");
    expect(event?.contexts?.app?.app_name).toBe("auditjob.me");
    expect(event?.tags?.route).toBe("roles");
  });

  it("scrubs a credential that leaked into an exception message", () => {
    const event = sanitizeSentryEvent(
      errorEvent({
        exception: {
          values: [
            { type: "Error", value: `failed to parse ${LEAKED_FRAGMENT}` },
            { type: "Error", value: `refresh_token=${OPAQUE_VALUE}` },
          ],
        },
      }),
    );

    expectNoCredentials(event);
    // The readable part survives; everything from the fragment on is cut.
    expect(event?.exception?.values?.[0]?.value).toBe("failed to parse ");
    // A credential parameter that survives the URL surgery takes the whole string
    // with it. Note the boundary this inherits from the shared rule: a credential is
    // recognised at a URL delimiter (start, `?`, `#`, `&`), not mid-sentence — which
    // matches the vector, since every carrier here is a URL or a URL fragment.
    expect(event?.exception?.values?.[1]?.value).toBe("<redacted>");
  });

  it("leaves a harmless event byte-identical, stack frames and all", () => {
    const clean = {
      event_id: "9f1b2c3d4e5f6071",
      level: "error",
      environment: "production",
      transaction: "/roles/:id",
      request: {
        url: "https://auditjob.me/roles?utm_source=newsletter&q=product+manager",
        headers: {
          Referer: "https://auditjob.me/",
          "User-Agent": "Mozilla/5.0",
        },
      },
      breadcrumbs: [
        {
          category: "navigation",
          data: { from: "/", to: "/roles" },
          timestamp: 1785093815,
        },
        {
          category: "xhr",
          data: {
            method: "GET",
            url: "https://api.auditjob.me/roles",
            status_code: 200,
          },
        },
        { category: "console", level: "log", message: "queue flushed" },
      ],
      exception: {
        values: [
          {
            type: "TypeError",
            value: "cannot read properties of null (reading 'title')",
            stacktrace: {
              frames: [
                {
                  filename: "https://auditjob.me/assets/index-a1b2c3.js",
                  function: "RoleCard",
                  lineno: 42,
                  colno: 7,
                },
                {
                  filename: "https://auditjob.me/assets/vendor-d4e5f6.js",
                  function: "renderWithHooks",
                  lineno: 11,
                  colno: 3,
                },
              ],
            },
          },
        ],
      },
      tags: { route: "roles" },
      extra: { queueLength: 3 },
    } as unknown as SentryErrorEvent;

    expect(sanitizeSentryEvent(structuredClone(clean))).toEqual(clean);
  });

  it("never throws, and fails closed rather than sending an event it could not clean", () => {
    expect(sanitizeSentryEvent(null as unknown as SentryErrorEvent)).toBeNull();
    expect(sanitizeSentryEvent(undefined as unknown as SentryErrorEvent)).toBeNull();
    expect(sanitizeSentryEvent("boom" as unknown as SentryErrorEvent)).toBeNull();

    const hostile = {} as SentryErrorEvent;
    Object.defineProperty(hostile, "request", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => sanitizeSentryEvent(hostile)).not.toThrow();
    expect(sanitizeSentryEvent(hostile)).toBeNull();
  });
});

describe("sanitizeSentryBreadcrumb", () => {
  it("drops the fragment off navigation from/to", () => {
    const crumb = sanitizeSentryBreadcrumb({
      category: "navigation",
      data: { from: LEAKED_RELATIVE, to: "/roles" },
    });

    expectNoCredentials(crumb);
    expect(crumb?.data).toEqual({ from: "/", to: "/roles" });
  });

  it("drops the fragment even if the OAuth parameter names change", () => {
    // The generic rule keys off today's parameter names. This one does not: `from`
    // and `to` lose their fragment unconditionally, so a Supabase change cannot
    // quietly reopen the hole.
    const crumb = sanitizeSentryBreadcrumb({
      category: "navigation",
      data: { from: "/#future_session_key=abc123", to: "/roles" },
    });
    expect(crumb?.data).toEqual({ from: "/", to: "/roles" });
  });

  it("strips credential params from an xhr breadcrumb URL and keeps the rest", () => {
    const crumb = sanitizeSentryBreadcrumb({
      category: "xhr",
      data: {
        method: "GET",
        url: "https://auditjob.me/auth/callback?code=8d3f-secret&state=xyz",
        status_code: 500,
      },
    });

    expect(crumb?.data).toEqual({
      method: "GET",
      url: "https://auditjob.me/auth/callback?state=xyz",
      status_code: 500,
    });
  });

  it("scrubs a URL logged to the console", () => {
    const crumb = sanitizeSentryBreadcrumb({
      category: "console",
      level: "log",
      message: LEAKED_URL,
    });
    expectNoCredentials(crumb);
    expect(crumb?.message).toBe("https://auditjob.me/");
  });

  it("leaves a harmless breadcrumb byte-identical", () => {
    const clean: Breadcrumb = {
      category: "ui.click",
      message: "button#save[aria-label='Save role']",
      level: "info",
      timestamp: 1785093815,
      data: { from: "/roles", to: "/tracker" },
    };
    expect(sanitizeSentryBreadcrumb(structuredClone(clean))).toEqual(clean);
  });

  it("never throws, and fails closed", () => {
    expect(sanitizeSentryBreadcrumb(null as unknown as Breadcrumb)).toBeNull();
    expect(sanitizeSentryBreadcrumb(undefined as unknown as Breadcrumb)).toBeNull();

    const hostile = {} as Breadcrumb;
    Object.defineProperty(hostile, "data", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => sanitizeSentryBreadcrumb(hostile)).not.toThrow();
    expect(sanitizeSentryBreadcrumb(hostile)).toBeNull();
  });
});

/**
 * The pure tests above pin the sanitizer. This one pins the WIRING — that the real
 * @sentry/react, with its real default integrations, actually routes an error
 * captured on the OAuth callback URL through both hooks before anything reaches the
 * transport. Removing `beforeSend` and `beforeBreadcrumb` from the init below puts
 * the full token-bearing fragment back on the wire (in `request.url`, in
 * `request.headers.Referer` and in the navigation breadcrumb's `from` / `to`), which
 * is how this test was proven to be able to fail.
 */
describe("Sentry.init wiring", () => {
  afterAll(async () => {
    const { close } = await import("@sentry/react");
    await close(2000);
  });

  it("puts no token material on the wire when an error is captured after sign-in", async () => {
    const Sentry = await import("@sentry/react");
    const envelopes: unknown[] = [];

    // Land on the OAuth callback URL, fragment and all, BEFORE init — so Sentry's
    // history instrumentation is not yet installed and this does not itself record a
    // breadcrumb. This is what Supabase's implicit flow leaves in the address bar.
    window.history.replaceState({}, "", `/${LEAKED_FRAGMENT}`);

    Sentry.init({
      // Assembled at runtime so a DSN-shaped literal never lands in the repo.
      dsn: ["https://", "examplepublickey", "@o0.ingest.sentry.io/0"].join(""),
      tracesSampleRate: 0,
      environment: "test",
      beforeSend: sanitizeSentryEvent,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
      // Test-only: keep the run offline and the payload readable.
      transport: () => ({
        send: async (envelope: unknown) => {
          envelopes.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });

    // Navigate away and back, so the fragment shows up as a breadcrumb `from` AND a
    // breadcrumb `to`, and is back in `location.href` for HttpContext to copy.
    window.history.pushState({}, "", "/roles");
    window.history.pushState({}, "", `/${LEAKED_FRAGMENT}`);

    Sentry.captureException(new Error("boom during callback"));
    await Sentry.flush(2000);

    expect(envelopes.length).toBeGreaterThan(0);
    const wire = JSON.stringify(envelopes);
    // Guards the guard: if the envelope ever stops carrying these, the assertion
    // below would pass vacuously.
    expect(wire).toContain("boom during callback");
    expect(wire).toContain('"url"');
    expect(wire).toContain('"navigation"');
    expectNoCredentials(wire);
  });
});

/**
 * The wiring test above drives its own `Sentry.init`. This one closes the last gap:
 * that the app's real entry point installs both hooks. A sanitizer that works but is
 * never wired in is the failure mode this catches.
 */
describe("src/main.tsx installs both hooks", () => {
  const source = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");

  it("imports the shared Sentry sanitizer", () => {
    expect(source).toMatch(/from\s+["']\.\/lib\/sentry-sanitize["']/);
  });

  it("passes beforeSend and beforeBreadcrumb to Sentry.init", () => {
    const init = source.slice(source.indexOf("Sentry.init("));
    expect(init.slice(0, init.indexOf("});"))).toContain("beforeSend: sanitizeSentryEvent");
    expect(init.slice(0, init.indexOf("});"))).toContain("beforeBreadcrumb: sanitizeSentryBreadcrumb");
  });
});
