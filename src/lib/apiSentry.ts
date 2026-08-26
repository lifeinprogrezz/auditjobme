/**
 * Sentry for the Vercel functions (issue #145).
 *
 * The four functions under api/ used to report errors only to console, and the
 * Vercel runtime-log API stopped answering on the Hobby plan (log volume past the
 * billing limit). Every serious bug in this codebase so far reported success while
 * the work did not happen, and the proof lived in those logs. So the functions now
 * report to the same Sentry project as the client, with the same sanitize rules
 * plus one server-side rule of their own.
 *
 * What is sent: thrown errors (tagged with the function name), the explicit
 * failure lines the handlers already print (`reportApiError`), and the per-run
 * summary object as a "run" context (`setRunSummary`). Ids and counts only.
 *
 * What is never sent: CV text, job descriptions, email subjects or bodies, email
 * addresses. `scrubContent` enforces that by KEY (cv_text, jd_text, subject, html,
 * text, to, from, ...) and by VALUE (any email address), on top of the credential
 * rule shared with the client (./sentry-sanitize). Pinned by apiSentry.test.ts.
 *
 * Env: `SENTRY_DSN` (server-side, add it in Vercel), falling back to
 * `VITE_SENTRY_DSN` for the case where only the client variable exists. No DSN →
 * every export is a no-op and the handlers run exactly as before.
 *
 * Lives under src/lib/ (not api/) so Vercel never exposes it as a route; the .js
 * extensions are load-bearing for Node ESM — see the header of scorePrefilter.ts
 * and src/test/api-esm-imports.test.ts.
 */
import * as Sentry from "@sentry/node";
import type { ErrorEvent as SentryErrorEvent } from "@sentry/node";
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from "./sentry-sanitize.js";

type Res = { status: (code: number) => Res; json: (body: unknown) => void };
type Handler<Req, R extends Res> = (req: Req, res: R) => Promise<void>;

/** Keys whose value is user content, never diagnostics. Matched case-insensitively
 *  after stripping `_` so `cv_text`, `cvText` and `CVTEXT` all hit. */
const CONTENT_KEYS = new Set([
  "cvtext",
  "cv",
  "jdtext",
  "jd",
  "description",
  "subject",
  "html",
  "text",
  "body",
  "content",
  "to",
  "from",
  "email",
  "system",
  "messages",
  "reason",
  "fitbullets",
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const REDACTED = "<redacted>";
const MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isContentKey(key: string): boolean {
  return CONTENT_KEYS.has(key.replace(/_/g, "").toLowerCase());
}

/** Replace every email address in a string; everything else is byte-identical. */
export function scrubEmails(value: string): string {
  return value.replace(EMAIL_RE, "<email>");
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubEmails(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isContentKey(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

/**
 * The server-side rule: a property bag reduced to ids and counts. Content-bearing
 * keys are replaced outright (their value is never inspected), and any email
 * address left in a string is replaced. Fails closed like the shared sanitizer.
 */
export function scrubContent(bag: Record<string, unknown>): Record<string, unknown> {
  try {
    if (!isPlainObject(bag)) return {};
    return scrubValue(bag, 0) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** `beforeSend`: the shared credential rule first, then the content rule. */
export function sanitizeApiEvent(event: SentryErrorEvent): SentryErrorEvent | null {
  const shared = sanitizeSentryEvent(event);
  if (!shared) return null;
  try {
    if (shared.extra) shared.extra = scrubContent(shared.extra as Record<string, unknown>);
    if (shared.contexts) {
      shared.contexts = scrubContent(shared.contexts as Record<string, unknown>) as SentryErrorEvent["contexts"];
    }
    if (shared.tags) shared.tags = scrubContent(shared.tags as Record<string, unknown>) as SentryErrorEvent["tags"];
    if (typeof shared.message === "string") shared.message = scrubEmails(shared.message);
    for (const exception of shared.exception?.values ?? []) {
      if (typeof exception.value === "string") exception.value = scrubEmails(exception.value);
    }
    if (Array.isArray(shared.breadcrumbs)) {
      for (const crumb of shared.breadcrumbs) {
        if (crumb.data) crumb.data = scrubContent(crumb.data as Record<string, unknown>);
        if (typeof crumb.message === "string") crumb.message = scrubEmails(crumb.message);
      }
    }
    return shared;
  } catch {
    return null;
  }
}

let initialised = false;
let active = false;

/**
 * Initialise Sentry for a function. Idempotent per process (Vercel reuses warm
 * instances). Returns whether reporting is active: false without a DSN, in which
 * case nothing else in this module does anything.
 */
export function initApiSentry(fnName: string): boolean {
  if (initialised) return active;
  initialised = true;
  const dsn = process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.VERCEL_ENV ?? "development",
    // Errors only. The OpenTelemetry setup exists for tracing, which is off, and
    // it needs a loader hook under ESM that Vercel does not run.
    skipOpenTelemetrySetup: true,
    sendDefaultPii: false,
    initialScope: { tags: { function: fnName } },
    beforeSend: sanitizeApiEvent,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
  });
  active = true;
  return true;
}

/** An explicit failure line the handler already prints, as an error-level event. */
export function reportApiError(message: string, extra?: Record<string, unknown>): void {
  if (!active) return;
  Sentry.captureMessage(message, { level: "error", ...(extra ? { extra } : {}) });
}

/** The per-run summary (counts only) attached to every event of this invocation. */
export function setRunSummary(summary: Record<string, unknown>): void {
  if (!active) return;
  Sentry.setContext("run", summary);
}

/**
 * Wrap a Vercel handler. A thrown error is captured with the function name as a
 * tag and rethrown, so the platform answers 500 exactly as before; every path
 * flushes before returning, or the event dies with the invocation.
 */
export function withSentry<Req, R extends Res>(fnName: string, handler: Handler<Req, R>): Handler<Req, R> {
  return async (req, res) => {
    if (!initApiSentry(fnName)) {
      await handler(req, res);
      return;
    }
    await Sentry.withIsolationScope(async (scope) => {
      scope.setTag("function", fnName);
      try {
        await handler(req, res);
      } catch (e) {
        Sentry.captureException(e, { tags: { function: fnName } });
        throw e;
      } finally {
        await Sentry.flush(2000).catch(() => undefined);
      }
    });
  };
}
