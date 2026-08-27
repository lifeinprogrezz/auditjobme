// Scrape watchdog (2026-08-27) — sibling of api/spend-alert.ts.
//
// Layer 1, live now: once a day, check that the daily scrape published a fresh
// dataplane artifact to Supabase Storage. That artifact is written by the LAST
// step of the ten-step scrape pipeline, so a fresh timestamp proves the whole
// chain finished. A stale one, or one that cannot be read at all, emails the
// owner through Resend on the same path the daily spend alert uses.
//
// Layer 2, dormant until a token exists: when SCRAPE_DISPATCH_TOKEN holds a
// GitHub token with actions write permission, the same call also restarts the
// scrape workflow through the GitHub workflow dispatch endpoint, at most once a
// day. With no token it behaves exactly like layer 1 and never errors, the same
// graceful shape as public.tick_worker doing nothing while its Vault secret is
// absent.
//
// The fail-safe direction lives in src/lib/scrapeWatchdog.ts: when the check
// cannot tell, it ALERTS. See the comment there.
//
// Scheduled by pg_cron at 08:00 UTC, three hours after the scrape workflow's
// 05:00 schedule (supabase/migrations/20260827200000_scrape_watchdog.sql).
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY / CRON_SECRET
// (same contract as api/spend-alert.ts) + optional OWNER_ALERT_EMAIL,
// SCRAPE_DISPATCH_TOKEN, SCRAPE_DISPATCH_REPO.
import { createClient } from "@supabase/supabase-js";
import { cronAuthResult } from "../src/lib/nightly.js";
import { BRAND_NAME } from "../src/lib/brandName.js";
import {
  decideDataplaneFreshness,
  decideDispatch,
  buildWatchdogSubject,
  buildWatchdogBody,
  type DataplaneProbe,
} from "../src/lib/scrapeWatchdog.js";
import { reportApiError, setRunSummary, withSentry } from "../src/lib/apiSentry.js";

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

// Same sender as the nightly digest and the spend alert; all three move together.
const EMAIL_FROM = `${BRAND_NAME} <matches@northgoing.com>`;
const DEFAULT_OWNER_EMAIL = "hello@lifeinprogrezz.com";

const BUCKET = "dataplane";
const ARTIFACT = "dataplane.json";
const DEFAULT_REPO = "lifeinprogrezz/northgoing";
const WORKFLOW_FILE = "scrape.yml";
const WORKFLOW_REF = "main";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Fire one Resend notification. Fail-soft: logs and returns false, never throws. */
async function sendEmail(apiKey: string, to: string, subject: string, text: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text,
        html: `<pre style="font-family:monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      }),
    });
    if (!res.ok) {
      console.warn(`[scrape-watchdog] Resend ${res.status}:`, await res.text().catch(() => ""));
      reportApiError(`[scrape-watchdog] Resend non-ok ${res.status}`, { status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[scrape-watchdog] Resend fetch failed:", e);
    return false;
  }
}

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        options: { limit: number; search: string },
      ) => Promise<{ data: { name: string; updated_at?: string | null }[] | null; error: { message: string } | null }>;
    };
  };
};

/**
 * When did the last pipeline step publish the artifact? Every failure path
 * returns a `problem`, never a throw and never a guessed timestamp, because the
 * verdict for "cannot tell" is an alert.
 */
async function probeDataplane(db: StorageClient): Promise<DataplaneProbe> {
  try {
    const { data, error } = await db.storage.from(BUCKET).list("", { limit: 100, search: ARTIFACT });
    if (error) return { updatedAt: null, problem: `Supabase Storage said: ${error.message}` };
    const row = (data ?? []).find((o) => o.name === ARTIFACT);
    if (!row) return { updatedAt: null, problem: null };
    if (!row.updated_at) {
      return { updatedAt: null, problem: `${ARTIFACT} exists but carries no last-written time.` };
    }
    return { updatedAt: row.updated_at, problem: null };
  } catch (e) {
    return { updatedAt: null, problem: `the storage read threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "northgoing-scrape-watchdog",
});

/**
 * When did a dispatch last start this workflow? `null` inside `readable: true`
 * means it never has. A failed read returns `readable: false`, which stops the
 * dispatch: the once-a-day bound has to be provable, not assumed.
 */
async function lastDispatchedRun(
  repo: string,
  token: string,
): Promise<{ readable: boolean; lastDispatchAt: string | null }> {
  try {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=1`;
    const res = await fetch(url, { headers: githubHeaders(token) });
    if (!res.ok) {
      console.warn(`[scrape-watchdog] GitHub runs ${res.status}:`, await res.text().catch(() => ""));
      return { readable: false, lastDispatchAt: null };
    }
    const body = (await res.json()) as { workflow_runs?: { created_at?: string | null }[] };
    const created = body.workflow_runs?.[0]?.created_at ?? null;
    return { readable: true, lastDispatchAt: created };
  } catch (e) {
    console.warn("[scrape-watchdog] GitHub runs fetch failed:", e);
    return { readable: false, lastDispatchAt: null };
  }
}

/** Start the scrape workflow. Fail-soft: logs and returns false, never throws. */
async function dispatchWorkflow(repo: string, token: string): Promise<boolean> {
  try {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: WORKFLOW_REF }),
    });
    if (!res.ok) {
      console.warn(`[scrape-watchdog] GitHub dispatch ${res.status}:`, await res.text().catch(() => ""));
      reportApiError(`[scrape-watchdog] GitHub dispatch non-ok ${res.status}`, { status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[scrape-watchdog] GitHub dispatch failed:", e);
    return false;
  }
}

async function handler(req: Req, res: Res): Promise<void> {
  const authError = cronAuthResult(
    [process.env.CRON_SECRET, process.env.CRON_SECRET_DB],
    req.headers["authorization"],
  );
  if (authError) {
    res.status(authError.status).json({ error: authError.error });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_ALERT_EMAIL || DEFAULT_OWNER_EMAIL;
  const dispatchToken = (process.env.SCRAPE_DISPATCH_TOKEN ?? "").trim();
  const repo = process.env.SCRAPE_DISPATCH_REPO || DEFAULT_REPO;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }
  const admin: StorageClient = createClient(supabaseUrl, serviceKey);

  const now = new Date();
  const probe = await probeDataplane(admin);
  const verdict = decideDataplaneFreshness(probe, now.getTime());

  // The run history is only read when there is something to act on and a token
  // to act with. A healthy morning costs one storage read and nothing else.
  const history =
    verdict.alert && dispatchToken.length > 0
      ? await lastDispatchedRun(repo, dispatchToken)
      : { readable: false, lastDispatchAt: null };

  const decision = decideDispatch({
    alert: verdict.alert,
    tokenPresent: dispatchToken.length > 0,
    runHistoryReadable: history.readable,
    lastDispatchAt: history.lastDispatchAt,
    nowMs: now.getTime(),
  });

  let dispatched = false;
  if (decision.dispatch) dispatched = await dispatchWorkflow(repo, dispatchToken);

  let emailed = false;
  if (verdict.alert) {
    if (!resendKey) {
      console.warn("[scrape-watchdog] alert tripped but RESEND_API_KEY is missing; not emailed");
    } else {
      emailed = await sendEmail(
        resendKey,
        ownerEmail,
        buildWatchdogSubject(verdict, decision),
        buildWatchdogBody(verdict, decision, now.toISOString()),
      );
    }
  }

  const summary = {
    state: verdict.state,
    alert: verdict.alert,
    ageHours: verdict.ageHours,
    dataplaneUpdatedAt: probe.updatedAt,
    dispatchPlanned: decision.dispatch,
    dispatched,
    emailed,
  };
  console.log("[scrape-watchdog]", JSON.stringify({ ...summary, reasons: verdict.reasons }));
  setRunSummary(summary);

  res.status(200).json({ ok: true, ...summary, reasons: verdict.reasons, dispatchReason: decision.reason });
}

export default withSentry("scrape-watchdog", handler);
