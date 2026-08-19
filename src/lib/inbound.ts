// Issue #75 — inbox → tracker auto-advance (learning-loop stage 2), Option A:
// per-user forwarding address. Pure logic ONLY: token parsing, ATS sender mapping,
// the confirmation/rejection/interview classifier, company+role fuzzy matching, and
// the stale-guarded transition decision. No React, no supabase imports — pinned by
// src/test/inbound.test.ts, consumed by api/inbound-email.ts. Rule + code move together.
//
// Stale-guard semantics are the career-ops ones, ported exactly:
//   - an OLD rejection never overwrites a LATER interview/offer (proof = the email's
//     Date header versus the application's last status change),
//   - a destructive flip (→ rejected) needs a recent email (10-day recency window;
//     the same guard career-ops added to reconcile-inbox after the Antare misfire),
//   - a closed (rejected) application is never auto-reopened,
//   - the ladder never moves backwards (interview/offer never downgrade to applied).
import type { Status } from "./tracker"; // type-only: erased at compile, so the api/ ESM path never resolves it

/** The inbound domain users forward to. DNS + the inbound provider for this domain
 *  are external setup (see the PR body's needs-human checklist). */
export const FORWARDING_DOMAIN = "northgoing.com";

/** How stale a rejection email may be (versus "now") and still flip a card. */
export const REJECTION_RECENCY_DAYS = 10;

export function forwardingAddress(token: string): string {
  return `u-${token}@${FORWARDING_DOMAIN}`;
}

/**
 * Pull the per-user token out of the recipient list. Accepts a single address, a
 * comma-separated header, or an array (providers differ); the address may carry a
 * display name. Case-insensitive; returns null when no `u-{token}@northgoing.com`
 * recipient is present (the endpoint then rejects the delivery).
 */
export function extractForwardingToken(to: string | string[] | undefined | null): string | null {
  if (to == null) return null;
  const haystack = (Array.isArray(to) ? to : [to]).join(",");
  const m = haystack.match(new RegExp(`u-([a-z0-9]+)@${FORWARDING_DOMAIN.replace(/\./g, "\\.")}`, "i"));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Shared-secret auth for a server-to-server webhook, same shape as nightly's
 * cronAuthResult but with the env var named honestly in the error.
 */
export function secretAuthResult(
  envName: string,
  secret: string | undefined | null,
  authHeader: string | string[] | undefined | null,
): { status: number; error: string } | null {
  if (!secret) return { status: 500, error: `${envName} not configured` };
  if (authHeader !== `Bearer ${secret}`) return { status: 401, error: "Unauthorized" };
  return null;
}

// ---------------------------------------------------------------------------
// Sender → ATS
// ---------------------------------------------------------------------------

/** Sender-domain suffix → ATS name. Suffix match so subdomains count
 *  (us.greenhouse-mail.io, hire.lever.co, candidates.workable.com, …). */
export const ATS_SENDER_DOMAINS: ReadonlyArray<readonly [string, string]> = [
  ["greenhouse.io", "greenhouse"],
  ["greenhouse-mail.io", "greenhouse"],
  ["lever.co", "lever"],
  ["ashbyhq.com", "ashby"],
  ["smartrecruiters.com", "smartrecruiters"],
  ["workable.com", "workable"],
  ["myworkday.com", "workday"],
  ["myworkdaysite.com", "workday"],
  ["icims.com", "icims"],
  ["teamtailor.com", "teamtailor"],
  ["teamtailor-mail.com", "teamtailor"],
  ["recruitee.com", "recruitee"],
  ["personio.de", "personio"],
  ["personio.com", "personio"],
  ["factorialhr.com", "factorial"],
  ["bamboohr.com", "bamboohr"],
  ["jobvite.com", "jobvite"],
];

/** Extract the bare sender domain from a From header ("Acme" <no-reply@x.y> → x.y). */
export function senderDomain(from: string | undefined | null): string | null {
  if (!from) return null;
  const m = from.match(/@([a-z0-9.-]+)/i);
  return m ? m[1].toLowerCase().replace(/[>.\s]+$/, "") : null;
}

/** ATS name for a From header, or null when the sender is not a known ATS.
 *  Null does NOT reject the email — companies also mail from their own domain. */
export function atsFromSender(from: string | undefined | null): string | null {
  const domain = senderDomain(from);
  if (!domain) return null;
  for (const [suffix, ats] of ATS_SENDER_DOMAINS) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return ats;
  }
  return null;
}

/** Gmail's forward-to-this-address verification mail (see extractGmailConfirmationCode). */
export function isGmailForwardingConfirmation(from: string | undefined | null): boolean {
  return senderDomain(from) === "google.com" && /forwarding-noreply@/i.test(from ?? "");
}

/**
 * When a user adds their forwarding address in Gmail, Google sends a confirmation
 * code TO that address — i.e. to us, not to them. Surface it back (stored on the
 * token row, shown in Settings) or Option A dead-ends at its very first step.
 * Subject shape: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from …".
 */
export function extractGmailConfirmationCode(subject: string | undefined | null): string | null {
  const m = (subject ?? "").match(/#\s*(\d{6,12})/);
  return m ? m[1] : null;
}

/**
 * The link Gmail ACTUALLY sends. Measured 2026-08-19 against a real confirmation
 * mail: there is no numeric code anywhere. The subject reads
 * "(Gmail Forwarding confirmation – Receive mail from …" with no code at all, and
 * the body carries a link the user clicks instead. extractGmailConfirmationCode
 * above therefore returns null on live mail; it is kept only for the older
 * "(#123456789)" format some accounts may still receive.
 *
 * The same mail contains TWO links that differ by a single letter:
 *   /mail/vf-…  confirms the forwarding request
 *   /mail/uf-…  CANCELS it
 * Handing someone the cancel link would silently undo the setup they are trying
 * to complete, so this matches vf- only and never falls back to "the first
 * google link in the body".
 */
export function extractGmailConfirmationLink(body: string | undefined | null): string | null {
  // Stops at whitespace, quotes and angle brackets, so it reads the same out of
  // plain text and out of an href in html mail.
  const m = (body ?? "").match(/https:\/\/mail\.google\.com\/mail\/vf-[^\s"'<>]+/i);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export type InboundKind = "confirmation" | "rejection" | "interview" | "unknown";

// Order matters and is deliberate:
//   1. rejection — rejections routinely OPEN with confirmation language ("Thank you
//      for applying to Acme… unfortunately"), so rejection phrases must win first.
//   2. confirmation — confirmations routinely MENTION interviews ("if selected, we
//      will invite you to an interview"), so confirmation must beat interview.
//   3. interview — only reached when nothing above matched.
const REJECTION_RE: RegExp[] = [
  /not\s+(?:be\s+)?(?:moving|to\s+move)\s+forward/i,
  /(?:decided|chosen)\s+to\s+(?:move\s+forward|proceed|continue)\s+with\s+other/i,
  /(?:pursue|proceed\s+with)\s+other\s+(?:candidates|applicants)/i,
  /will\s+not\s+be\s+(?:progressing|proceeding|advancing)/i,
  /not\s+to\s+(?:proceed|progress)\s+with\s+your\s+application/i,
  /no\s+longer\s+under\s+consideration/i,
  /(?:has|have)\s+not\s+been\s+(?:selected|successful)/i,
  /(?:position|role)\s+has\s+been\s+filled/i,
  // "unfortunately"/"regret" alone is too loose — require application context nearby.
  /(?:unfortunately|we\s+regret|regret\s+to\s+inform)[\s\S]{0,200}?(?:application|candidacy|candidature|position|role|profile)/i,
];

const CONFIRMATION_RE: RegExp[] = [
  /thank(?:s|\s+you)\s+for\s+(?:applying|your\s+application|your\s+interest\s+in\s+applying)/i,
  /application\s+(?:was\s+|has\s+been\s+)?(?:received|submitted)/i,
  /we(?:'ve|\s+have)\s+received\s+your\s+application/i,
  /successfully\s+(?:submitted|applied)/i,
  /application\s+confirmation/i,
  /your\s+application\s+(?:to|for|at)\s+.{2,80}\s+(?:has\s+been\s+received|was\s+sent)/i,
];

const INTERVIEW_RE: RegExp[] = [
  /schedul(?:e|ing)\s+(?:a\s+|your\s+)?(?:call|interview|conversation|chat|meeting)/i,
  /invit(?:e|ing)\s+you\s+to\s+(?:a\s+|an\s+|the\s+)?(?:call|interview|chat|conversation|meeting|next\s+(?:stage|step|round))/i,
  /(?:would|we'd)\s+(?:love|like)\s+to\s+(?:speak|talk|chat|meet)\s+with\s+you/i,
  /move\s+(?:you\s+)?(?:forward\s+)?to\s+(?:the\s+)?(?:next\s+(?:stage|step|round)|an?\s+interview)/i,
  /book\s+a\s+(?:time|slot|call)/i,
  /(?:share|send)\s+(?:us\s+)?your\s+availability/i,
  /calendly\.com|cal\.com\/|savvycal\.com/i,
  /interview\s+(?:invitation|invite|request|scheduled|confirmed)/i,
];

export function classifyInboundEmail(input: { subject?: string | null; text?: string | null }): InboundKind {
  const haystack = `${input.subject ?? ""}\n${input.text ?? ""}`;
  if (REJECTION_RE.some((re) => re.test(haystack))) return "rejection";
  if (CONFIRMATION_RE.some((re) => re.test(haystack))) return "confirmation";
  if (INTERVIEW_RE.some((re) => re.test(haystack))) return "interview";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Company + role extraction, and the fuzzy match against tracker rows
// ---------------------------------------------------------------------------

/** Legal suffixes and cruft stripped before comparing company names. */
export function normalizeCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(?:inc|ltd|llc|gmbh|s\.?l\.?u?|s\.?a\.?s?|b\.?v\.?|a\.?b\.?|plc|limited|co)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ROLE_STOPWORDS = new Set(["the", "a", "an", "of", "and", "for", "at", "in", "to"]);

function titleTokens(s: string): Set<string> {
  return new Set(
    normalizeTitle(s)
      .split(" ")
      .filter((t) => t.length > 1 && !ROLE_STOPWORDS.has(t)),
  );
}

/** From-header display names are usually "{Company} Hiring Team" and similar. */
function companyFromDisplayName(from: string | undefined | null): string | null {
  if (!from) return null;
  const display = (from.match(/^\s*"?([^"<]+?)"?\s*</) ?? [null, null])[1];
  if (!display) return null;
  const stripped = display
    .replace(/\b(?:hiring|recruiting|recruitment|talent(?:\s+acquisition)?|careers?|jobs|people|team|hr|via\s+\w+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length >= 2 ? stripped : null;
}

/** Best-effort company + role guess from the subject line and From display name.
 *  Returns nulls freely — the matcher treats a missing guess as "no signal",
 *  never as a wildcard. */
export function extractCompanyRole(
  subject: string | undefined | null,
  from?: string | null,
): { company: string | null; role: string | null } {
  const s = (subject ?? "").replace(/^\s*(?:re|fwd?)\s*:\s*/i, "").trim();
  let company: string | null = null;
  let role: string | null = null;

  let m = s.match(/application\s+for\s+(?:the\s+)?(.{2,80}?)\s+(?:role|position|opening)\s+at\s+(.{2,60}?)\s*[.!]?$/i);
  if (m) {
    role = m[1].trim();
    company = m[2].trim();
  }
  if (!company) {
    m = s.match(/(?:your\s+application|applying|applied)\s+(?:to|at)\s+(.{2,60}?)(?:\s+for\s+(?:the\s+)?(.{2,80}?)(?:\s+(?:role|position|opening))?)?\s*[.!]?$/i);
    if (m) {
      company = m[1].trim();
      role = role ?? (m[2] ? m[2].trim() : null);
    }
  }
  if (!company) {
    m = s.match(/thank\s+you\s+for\s+applying\s+to\s+(.{2,60}?)\s*[.!]?$/i);
    if (m) company = m[1].trim();
  }
  if (!company) {
    m = s.match(/interview\s+with\s+(.{2,60}?)\s*[.!]?$/i);
    if (m) company = m[1].trim();
  }
  if (!role) {
    m = s.match(/your\s+application\s+for\s+(?:the\s+)?(.{2,80}?)(?:\s+(?:role|position|opening))?\s*[.!]?$/i);
    if (m) role = m[1].trim();
  }
  if (!company) company = companyFromDisplayName(from);
  return { company, role };
}

export type TrackedApp = {
  id: string;
  status: string;
  company: string;
  title: string;
};

/**
 * Fuzzy-match an email's company/role guess against the user's tracked applications.
 * Conservative by design: a COMPANY signal is required (role-only matching invents
 * moves), and an ambiguous multi-candidate outcome returns null rather than guess —
 * a wrong auto-advance costs more trust than a missed one. Cap-1 per company means
 * one in-flight candidate per company is the overwhelmingly common case anyway.
 */
export function matchApplication<T extends TrackedApp>(
  rows: T[],
  guess: { company: string | null; role: string | null },
): T | null {
  if (!guess.company) return null;
  const g = normalizeCompany(guess.company);
  if (g.length < 2) return null;

  const candidates = rows.filter((r) => {
    const c = normalizeCompany(r.company);
    if (!c) return false;
    return c === g || (c.length >= 3 && g.includes(c)) || (g.length >= 3 && c.includes(g));
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Several applications at the same company (historic rejections + one live one).
  if (guess.role) {
    const want = titleTokens(guess.role);
    let best: T | null = null;
    let bestScore = 0;
    for (const r of candidates) {
      const have = titleTokens(r.title);
      let overlap = 0;
      for (const t of want) if (have.has(t)) overlap++;
      const union = new Set([...want, ...have]).size || 1;
      const score = overlap / union;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      } else if (score === bestScore && score > 0) {
        best = null; // tie — ambiguous, refuse to guess
      }
    }
    if (best && bestScore > 0) return best;
  }

  // No usable role signal: only match when exactly one candidate is still live.
  const inFlight = candidates.filter((r) => ["applied", "responded", "interview", "offer"].includes(r.status));
  return inFlight.length === 1 ? inFlight[0] : null;
}

// ---------------------------------------------------------------------------
// Transition decision (the stale-guard lives here)
// ---------------------------------------------------------------------------

export type TransitionDecision =
  | { action: "advance"; to: Status }
  | { action: "confirm" } // ATS confirmation: stamp confirmed_at, status unchanged
  | { action: "skip"; reason: string };

export function decideTransition(input: {
  kind: InboundKind;
  currentStatus: Status;
  /** Parsed Date header of the email, null when absent/unparseable. */
  emailDate: Date | null;
  /** Latest status_events.changed_at for this application, null when none. */
  lastChangedAt: Date | null;
  now?: Date;
}): TransitionDecision {
  const { kind, currentStatus, emailDate, lastChangedAt } = input;
  const now = input.now ?? new Date();

  if (kind === "unknown") return { action: "skip", reason: "unclassified email" };

  if (kind === "confirmation") {
    // A tracked application already means at-least-applied; the confirmation's value
    // is the timestamp (honest funnel stats + the referral qualifying event, #78).
    return { action: "confirm" };
  }

  if (kind === "interview") {
    if (currentStatus === "interview" || currentStatus === "offer") {
      return { action: "skip", reason: "already at or past interview" };
    }
    if (currentStatus === "rejected") {
      // A closed application is never auto-reopened — a human decides that.
      return { action: "skip", reason: "closed application is never auto-reopened" };
    }
    return { action: "advance", to: "interview" };
  }

  // kind === "rejection"
  if (currentStatus === "rejected") return { action: "skip", reason: "already rejected" };

  // Recency guard (career-ops reconcile-inbox rule): a destructive flip needs a
  // recent email. Forwarded backlogs and re-deliveries must not rewrite the board.
  if (emailDate != null && now.getTime() - emailDate.getTime() > REJECTION_RECENCY_DAYS * 86_400_000) {
    return { action: "skip", reason: `rejection older than the ${REJECTION_RECENCY_DAYS}-day recency window` };
  }

  // THE stale-guard: an old rejection never overwrites a later interview/offer.
  // Downgrading a live interview needs PROOF the rejection is newer than the last
  // move — no email date is treated as no proof.
  if (currentStatus === "interview" || currentStatus === "offer") {
    if (emailDate == null) {
      return { action: "skip", reason: "undated rejection cannot overwrite a later interview" };
    }
    if (lastChangedAt != null && emailDate.getTime() <= lastChangedAt.getTime()) {
      return { action: "skip", reason: "stale rejection never overwrites a later interview" };
    }
  }

  return { action: "advance", to: "rejected" };
}

// ---------------------------------------------------------------------------
// Resend inbound webhook (#118)
// ---------------------------------------------------------------------------

/** What Resend's `email.received` webhook actually carries. */
export type ResendInboundMeta = {
  /** Fetch the body with this; the webhook does not contain one. */
  emailId: string;
  to: string[];
  from: string;
  subject: string | null;
  messageId: string | null;
  date: string | null;
};

/**
 * Read Resend's `email.received` event into the fields the pipeline needs.
 *
 * The webhook is METADATA ONLY — Resend's documentation is explicit that it
 * carries no body, headers or attachments, only their metadata — so this cannot
 * return a finished payload. It returns an `emailId` the caller exchanges for
 * the content at GET /emails/receiving/{id}.
 *
 * Recipients come from `to` AND `received_for`, and that union is load-bearing:
 * when a mailbox forwards, `to` keeps naming the ORIGINAL recipient while the
 * forwarding address lands in `received_for`. Reading only `to` would lose the
 * token on exactly the mail this feature exists to process.
 *
 * Returns null for any other event type, so a delivery or bounce ping can never
 * be mistaken for received mail and drive somebody's tracker.
 */
export function parseResendInboundEvent(event: unknown): ResendInboundMeta | null {
  if (!event || typeof event !== "object") return null;
  const e = event as { type?: unknown; data?: unknown };
  if (e.type !== "email.received" || !e.data || typeof e.data !== "object") return null;

  const d = e.data as Record<string, unknown>;
  const emailId = typeof d.email_id === "string" ? d.email_id : null;
  const from = typeof d.from === "string" ? d.from : null;
  if (!emailId || !from) return null;

  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];

  return {
    emailId,
    to: [...list(d.to), ...list(d.received_for)],
    from,
    subject: typeof d.subject === "string" ? d.subject : null,
    messageId: typeof d.message_id === "string" ? d.message_id : null,
    // The message's own timestamp, not the envelope's: the stale-guard compares
    // against when the mail was SENT, and an outer delivery time drifts from it.
    date: typeof d.created_at === "string" ? d.created_at : null,
  };
}
