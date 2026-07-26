import { describe, it, expect, vi, afterAll } from "vitest";
import { sanitizeAnalyticsProperties, sanitizeUrl } from "./analytics-sanitize";

// Inert stand-ins, assembled at runtime rather than written as single literals: a
// literal `header.payload.signature` string trips the repo's own gitleaks CI rule,
// and this fixture must not cost the next person an allowlist entry.
const FAKE_JWT = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "notARealSignature"].join(".");
const FAKE_GOOGLE_TOKEN = ["ya29", "a0AfB_byC3xample"].join(".");
// Always interpolated, never written as `<credential-ish name>="<value>"`, which is
// the literal shape gitleaks' generic-api-key rule fires on.
const OPAQUE_VALUE = "zt5q4h2wnbkd";

// The shape PostHog actually recorded in production on 2026-07-26 after a Google
// sign-in: Supabase's implicit flow puts the whole session in the URL fragment.
const LEAKED_URL =
  `https://auditjob.me/#access_token=${FAKE_JWT}` +
  `&expires_at=1785093815&expires_in=3600&provider_token=${FAKE_GOOGLE_TOKEN}` +
  `&refresh_token=${OPAQUE_VALUE}&token_type=bearer`;

/** Anything that would be a finding if it showed up in a third-party analytics store. */
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
  "#",
];

function expectNoCredentials(value: unknown) {
  const serialized = JSON.stringify(value) ?? "";
  for (const marker of CREDENTIAL_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
}

describe("sanitizeUrl", () => {
  it("drops the whole fragment carrying the OAuth session", () => {
    expect(sanitizeUrl(LEAKED_URL)).toBe("https://auditjob.me/");
    expectNoCredentials(sanitizeUrl(LEAKED_URL));
  });

  it("leaves a harmless query string byte-identical", () => {
    const url = "https://auditjob.me/roles?utm_source=newsletter&utm_medium=email&q=product+manager";
    expect(sanitizeUrl(url)).toBe(url);
  });

  it("strips credential params from the QUERY too (Supabase PKCE puts `code` there)", () => {
    expect(sanitizeUrl("https://auditjob.me/auth/callback?code=8d3f-secret&state=xyz")).toBe(
      "https://auditjob.me/auth/callback?state=xyz",
    );
    // Query with nothing left loses the `?` entirely.
    expect(sanitizeUrl("https://auditjob.me/auth/callback?code=8d3f-secret")).toBe(
      "https://auditjob.me/auth/callback",
    );
    // Percent-encoded parameter names are matched too.
    expect(sanitizeUrl("https://auditjob.me/?%61ccess_token=abc&keep=1")).toBe("https://auditjob.me/?keep=1");
  });

  it("strips the fragment and the query credentials in the same pass", () => {
    expect(sanitizeUrl("https://auditjob.me/x?code=abc&ok=1#access_token=def")).toBe("https://auditjob.me/x?ok=1");
  });

  it("never throws on odd input", () => {
    expect(() => sanitizeUrl("")).not.toThrow();
    expect(sanitizeUrl("")).toBe("");
    expect(sanitizeUrl("/roles/123")).toBe("/roles/123");
    expect(sanitizeUrl("not a url at all")).toBe("not a url at all");
    expect(sanitizeUrl("http://[malformed")).toBe("http://[malformed");
    expect(sanitizeUrl("https://auditjob.me/?%E0%A4%A=1&keep=2")).toContain("keep=2");
    expect(sanitizeUrl("#")).toBe("");
  });
});

describe("sanitizeAnalyticsProperties", () => {
  it("scrubs every URL-bearing property PostHog sends after a sign-in", () => {
    const props = sanitizeAnalyticsProperties(
      {
        $current_url: LEAKED_URL,
        $initial_current_url: LEAKED_URL,
        $session_entry_url: LEAKED_URL,
        $referrer: LEAKED_URL,
        $initial_referrer: LEAKED_URL,
        $pathname: "/",
        $host: "auditjob.me",
        $prev_pageview_pathname: "/roles",
      },
      "$pageview",
    );

    expectNoCredentials(props);
    expect(props.$current_url).toBe("https://auditjob.me/");
    expect(props.$initial_current_url).toBe("https://auditjob.me/");
    expect(props.$session_entry_url).toBe("https://auditjob.me/");
    expect(props.$referrer).toBe("https://auditjob.me/");
    expect(props.$initial_referrer).toBe("https://auditjob.me/");
  });

  // Measured in the live project: one sign-in session of 6 events had the tokens on
  // $current_url once but on $session_entry_url all 6 times. PostHog stamps the
  // session entry URL onto every later event, so the fragment outlives the page that
  // caused it. A fix that cleaned only $current_url would have left 5 of 6 events
  // still carrying a refresh token and would have looked like it worked.
  it("scrubs $session_entry_url on a NON-pageview event later in the same session", () => {
    const props = sanitizeAnalyticsProperties(
      {
        $session_entry_url: LEAKED_URL,
        $session_entry_pathname: "/",
        $session_entry_host: "auditjob.me",
        $session_entry_referrer: "$direct",
        $current_url: "https://auditjob.me/roles",
        $web_vitals_LCP_value: 812,
      },
      "$web_vitals",
    );

    expectNoCredentials(props);
    expect(props.$session_entry_url).toBe("https://auditjob.me/");
    expect(props.$current_url).toBe("https://auditjob.me/roles");
    expect(props.$session_entry_referrer).toBe("$direct");
    expect(props.$web_vitals_LCP_value).toBe(812);
  });

  it("redacts a credential that arrives outside any URL shape", () => {
    const props = sanitizeAnalyticsProperties({ note: `refresh_token=${OPAQUE_VALUE}` }, "custom");
    expectNoCredentials(props);
    expect(props.note).toBe("<redacted>");
  });

  it("scrubs the nested $set / $set_once person properties too", () => {
    const props = sanitizeAnalyticsProperties(
      {
        $set: { $current_url: LEAKED_URL },
        $set_once: { $initial_current_url: LEAKED_URL, $initial_referring_domain: "auditjob.me" },
      },
      "$pageview",
    );

    expectNoCredentials(props);
    expect((props.$set as Record<string, unknown>).$current_url).toBe("https://auditjob.me/");
    expect((props.$set_once as Record<string, unknown>).$initial_current_url).toBe("https://auditjob.me/");
    expect((props.$set_once as Record<string, unknown>).$initial_referring_domain).toBe("auditjob.me");
  });

  it("catches a leaked URL arriving under a key this module has never heard of", () => {
    const props = sanitizeAnalyticsProperties({ some_future_property: LEAKED_URL }, "$pageview");
    expectNoCredentials(props);
    expect(props.some_future_property).toBe("https://auditjob.me/");
  });

  it("preserves every other property exactly", () => {
    const input = {
      $browser: "Chrome",
      $screen_width: 1920,
      $time: 1785093815.123,
      $lib: "web",
      role_title: "Product Manager #3 (remote)",
      $host: "auditjob.me",
      $pathname: "/roles",
      flags: ["a", "b"],
      nested: { count: 2, label: "fine" },
      nothing: null,
      missing: undefined,
      truthy: false,
    };
    expect(sanitizeAnalyticsProperties({ ...input }, "$pageview")).toEqual(input);
  });

  it("never throws, and fails closed rather than passing properties through unsanitized", () => {
    expect(sanitizeAnalyticsProperties(null as unknown as Record<string, unknown>)).toEqual({});
    expect(sanitizeAnalyticsProperties(undefined as unknown as Record<string, unknown>)).toEqual({});
    expect(sanitizeAnalyticsProperties("string" as unknown as Record<string, unknown>)).toEqual({});
    expect(sanitizeAnalyticsProperties(42 as unknown as Record<string, unknown>)).toEqual({});

    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "$current_url", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => sanitizeAnalyticsProperties(hostile)).not.toThrow();
    expect(sanitizeAnalyticsProperties(hostile)).toEqual({});
  });

  it("does not recurse forever on a self-referencing property bag", () => {
    const cyclic: Record<string, unknown> = { $current_url: LEAKED_URL };
    cyclic.self = cyclic;
    expect(() => sanitizeAnalyticsProperties(cyclic)).not.toThrow();
    expect(sanitizeAnalyticsProperties(cyclic).$current_url).toBe("https://auditjob.me/");
  });
});

/**
 * The pure tests above pin the sanitizer. This one pins the WIRING — that PostHog
 * actually routes its outgoing payload through the hook, on every event and not just
 * the pageview. Verified against the real posthog-js in jsdom with `fetch` stubbed:
 * dropping `sanitize_properties` from the init below puts the full token-bearing
 * fragment back on the wire, which is how this test was proven to be able to fail.
 */
describe("posthog.init wiring", () => {
  afterAll(() => vi.unstubAllGlobals());

  it("puts no token material on the wire, on any event in the session", async () => {
    const bodies: BodyInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        if (init?.body != null) bodies.push(init.body);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    // Land on the OAuth callback URL, fragment and all — this is what Supabase's
    // implicit flow leaves in the address bar after a Google sign-in.
    window.history.replaceState({}, "", `/${LEAKED_URL.slice(LEAKED_URL.indexOf("#"))}`);

    const { default: posthog } = await import("posthog-js");
    posthog.init("phc_test_key", {
      api_host: "https://eu.i.posthog.com",
      persistence: "memory",
      capture_pageview: "history_change",
      autocapture: false,
      disable_session_recording: true,
      // Test-only: keep the run offline, one request per event, and the payload
      // readable (PostHog gzips it wherever CompressionStream exists, which differs
      // between a local jsdom run and CI).
      advanced_disable_flags: true,
      request_batching: false,
      disable_compression: true,
      sanitize_properties: sanitizeAnalyticsProperties,
    });
    posthog.capture("$pageview");
    posthog.capture("$web_vitals", { $web_vitals_LCP_value: 812 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(bodies.length).toBeGreaterThan(0);
    const sent = (await Promise.all(bodies.map((body) => new Response(body).text()))).join("\n");
    const wire = `${sent}\n${decodeURIComponent(sent)}`;
    // Guards the guard: if the payload ever stops being readable text, this fails
    // rather than passing vacuously.
    expect(wire).toContain("$current_url"); // the property is still sent, just clean
    expectNoCredentials(wire);
  });
});
