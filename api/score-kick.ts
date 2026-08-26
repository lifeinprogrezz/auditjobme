// The first-minute kick (issue #149, spec item A7).
//
// The backlog worker is scheduled every 10 minutes by
// .github/workflows/score-backlog.yml. GitHub throttles free-plan schedules: on
// 2026-08-26 it ran at 11:50, 12:52, 13:54 and 14:44, roughly hourly. A stranger
// who saved a CV at 14:43 saw nothing for over an hour. This endpoint lets the
// app ask for that user's drain the moment their CV or their targets are saved,
// so the first scores land in under a minute.
//
// HOW IT AUTHENTICATES — the whole point of a separate route:
//   - api/score-backlog.ts stays CRON_SECRET-protected, and the secret is never
//     read here. A browser must never hold it.
//   - The caller sends its own Supabase user JWT as `Authorization: Bearer <jwt>`.
//     The service-role client verifies it (`auth.getUser`), which is a real
//     signature + expiry check against the auth server, not a claim we trust.
//   - The drain then runs for THAT verified user id only. A caller cannot name
//     a user, so it can never spend on anybody else, and an anonymous caller has
//     no user to spend for at all.
//   - POST only, so a link, an image tag or a prefetch cannot trigger spend.
//   - One kick per user per two minutes (src/lib/scoreKick.ts). The limiter is
//     in-memory, so it is best-effort across warm instances; it bounds the common
//     case. The real ceiling stays the global monthly cap in the proxy edge
//     function, which nothing here can raise (the settled "no per-user cap before
//     launch" rule is untouched).
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (same contract as the worker).
// The .js specifiers are load-bearing for Node ESM — see scorePrefilter.ts.
import { createClient } from "@supabase/supabase-js";
import { runBacklog } from "./score-backlog.js";
import { bearerToken, createKickLimiter, kickRequestError } from "../src/lib/scoreKick.js";
// #145: thrown errors go to Sentry (ids and counts only). No DSN → no-op.
import { withSentry } from "../src/lib/apiSentry.js";

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

// Module scope, so it survives between invocations on a warm instance. A cold
// start forgets it, which is exactly the "best-effort" in the header.
const limiter = createKickLimiter();

async function handler(req: Req, res: Res): Promise<void> {
  const token = bearerToken(req.headers["authorization"]);
  const requestError = kickRequestError(req.method, token);
  if (requestError) {
    res.status(requestError.status).json({ error: requestError.error });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }
  const admin = createClient(supabaseUrl, serviceKey);

  // The identity check. A forged, expired or revoked token gets no user back, and
  // the request stops here having cost one auth call.
  const { data, error } = await admin.auth.getUser(token as string);
  const userId = data?.user?.id;
  if (error || !userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const verdict = limiter.take(userId, Date.now());
  if (!verdict.allowed) {
    res.status(429).json({ error: "Already scoring", retry_after_ms: verdict.retryAfterMs });
    return;
  }

  // Same function, same budget, same phases as the cron tick — narrowed to one
  // user. Concurrency with a cron tick is possible and only costs a repeat of
  // work already in flight; correctness is unaffected, because every landed score
  // upserts on (user, job, rubric).
  const { status, body } = await runBacklog({ onlyUserId: userId });
  res.status(status).json(body);
}

export default withSentry("score-kick", handler);
