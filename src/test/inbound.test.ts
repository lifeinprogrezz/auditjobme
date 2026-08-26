// Issue #75 — pins the inbound-email pure logic: forwarding-token parsing, the
// ATS sender map, the confirmation/rejection/interview classifier, company+role
// fuzzy matching, and ABOVE ALL the stale-guarded transition decision (an old
// rejection must never overwrite a later interview — the career-ops semantics,
// ported exactly). Rule + code move together with src/lib/inbound.ts.
import { describe, it, expect } from "vitest";
import {
  atsFromSender,
  classifyInboundEmail,
  decideTransition,
  extractCompanyRole,
  extractForwardingToken,
  extractGmailConfirmationLink,
  parseResendInboundEvent,
  extractGmailConfirmationCode,
  FORWARDING_DOMAIN,
  forwardingAddress,
  forwardingStatus,
  isConfirmUrl,
  isGmailConfirmSuccess,
  isGmailForwardingConfirmation,
  matchApplication,
  normalizeCompany,
  REJECTION_RECENCY_DAYS,
  secretAuthResult,
  senderDomain,
  type TrackedApp,
} from "@/lib/inbound";

const D = (iso: string) => new Date(iso);

describe("FORWARDING_DOMAIN", () => {
  it("names the domain the MX records are expected to serve", () => {
    // INFRA-BOUND, not brand: this constant is the sole binding between a user and
    // their forwarding address, because the database stores only the token, never
    // the address (supabase/migrations/20260811210000_inbox_forwarding.sql).
    //
    // Moved to northgoing.com on 2026-08-19, and the reason it was SAFE to move is
    // worth recording, because the usual reason it is not was asserted and turned
    // out to be false. Measured against production that day: track.auditjob.me had
    // NO MX record, inbound_tokens held ZERO rows, and zero users had completed
    // Gmail's per-address verification. The feature was shipped but dormant, so
    // there was no mail in flight and nobody to strand.
    //
    // It is the APEX, not a track.* subdomain, because that is where the MX
    // actually points: enabling Resend receiving put
    // `northgoing.com MX -> inbound-smtp.eu-west-1.amazonaws.com` on the apex and
    // left track.northgoing.com empty. The address follows the MX, never the other
    // way round. Receiving on a subdomain would mean registering it in Resend as
    // its own domain first.
    //
    // That is no longer true the moment MX exists and one user verifies. From then
    // on, renaming this does not move DNS: mail keeps arriving at the old address,
    // extractForwardingToken stops matching it, and every tracker silently stops
    // auto-advancing, with no error anywhere.
    //
    // The fixtures below are pinned to the same domain, so on their own a
    // find-and-replace would rewrite constant and fixtures together and stay green.
    // This assertion is the tripwire that goes red instead. Change it only in the
    // commit that actually moves the MX records.
    expect(FORWARDING_DOMAIN).toBe("northgoing.com");
  });
});

describe("extractForwardingToken", () => {
  it("parses the bare address", () => {
    expect(extractForwardingToken("u-abc123@northgoing.com")).toBe("abc123");
  });

  it("parses display-name and list forms, case-insensitively", () => {
    expect(extractForwardingToken('"Me" <U-DEF456@NorthGoing.Com>')).toBe("def456");
    expect(extractForwardingToken(["other@example.com", "u-tok9@northgoing.com"])).toBe("tok9");
  });

  it("returns null for other domains and malformed recipients — never guesses", () => {
    expect(extractForwardingToken("u-abc@track.evil.me")).toBeNull();
    // The apex now receives ALL mail for the domain, so this guard matters more
    // than it did: an address at the bare domain that is not a u-{token} address
    // must never drive a tracker. Only the u- prefix plus a token qualifies.
    expect(extractForwardingToken("someone@northgoing.com")).toBeNull();
    // The retired brand must not keep working either, or the migration is a no-op.
    expect(extractForwardingToken("u-abc123@track.auditjob.me")).toBeNull();
    expect(extractForwardingToken(null)).toBeNull();
    expect(extractForwardingToken(undefined)).toBeNull();
  });

  it("round-trips with forwardingAddress", () => {
    expect(extractForwardingToken(forwardingAddress("deadbeef01"))).toBe("deadbeef01");
  });
});

describe("secretAuthResult", () => {
  it("500s when the secret is unset (fail closed, named honestly)", () => {
    expect(secretAuthResult("INBOUND_EMAIL_SECRET", undefined, "Bearer x")).toEqual({
      status: 500,
      error: "INBOUND_EMAIL_SECRET not configured",
    });
  });

  it("401s on a wrong or missing bearer, passes on the exact one", () => {
    expect(secretAuthResult("X", "s3cret", "Bearer nope")?.status).toBe(401);
    expect(secretAuthResult("X", "s3cret", undefined)?.status).toBe(401);
    expect(secretAuthResult("X", "s3cret", "Bearer s3cret")).toBeNull();
  });
});

describe("atsFromSender / senderDomain", () => {
  it("maps the major ATS sender domains, including subdomains", () => {
    expect(atsFromSender("Acme <no-reply@us.greenhouse-mail.io>")).toBe("greenhouse");
    expect(atsFromSender("no-reply@hire.lever.co")).toBe("lever");
    expect(atsFromSender("Acme Recruiting <no-reply@ashbyhq.com>")).toBe("ashby");
    expect(atsFromSender("acme@candidates.workable.com")).toBe("workable");
    expect(atsFromSender("acme@myworkday.com")).toBe("workday");
    expect(atsFromSender("careers@acme.teamtailor-mail.com")).toBe("teamtailor");
  });

  it("returns null for a company's own domain WITHOUT rejecting the email", () => {
    expect(atsFromSender("talent@acme.com")).toBeNull();
    expect(senderDomain("talent@acme.com")).toBe("acme.com");
  });

  it("does not suffix-match lookalike domains", () => {
    expect(atsFromSender("x@evilgreenhouse.io")).toBeNull();
    expect(atsFromSender("x@greenhouse.io.evil.com")).toBeNull();
  });
});

describe("Gmail forwarding confirmation", () => {
  it("recognises Google's verification mail and extracts the code", () => {
    expect(isGmailForwardingConfirmation("forwarding-noreply@google.com")).toBe(true);
    expect(isGmailForwardingConfirmation("no-reply@greenhouse.io")).toBe(false);
    expect(
      extractGmailConfirmationCode("(#562241789) Gmail Forwarding Confirmation - Receive Mail from rober@gmail.com"),
    ).toBe("562241789");
    expect(extractGmailConfirmationCode("Thank you for applying")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

describe("classifyInboundEmail", () => {
  it("classifies ATS confirmations", () => {
    expect(classifyInboundEmail({ subject: "Thank you for applying to Acme!" })).toBe("confirmation");
    expect(classifyInboundEmail({ subject: "We have received your application" })).toBe("confirmation");
    expect(
      classifyInboundEmail({ subject: "Acme", text: "Your application has been submitted successfully." }),
    ).toBe("confirmation");
  });

  it("classifies rejections", () => {
    expect(
      classifyInboundEmail({ text: "We have decided to move forward with other candidates at this time." }),
    ).toBe("rejection");
    expect(classifyInboundEmail({ text: "we will not be moving forward with your application" })).toBe("rejection");
    expect(classifyInboundEmail({ text: "Unfortunately, your application was not retained for this role." })).toBe(
      "rejection",
    );
    expect(classifyInboundEmail({ text: "Your profile is no longer under consideration." })).toBe("rejection");
  });

  it("classifies interview invites", () => {
    expect(classifyInboundEmail({ text: "We would like to invite you to an interview next week." })).toBe("interview");
    expect(classifyInboundEmail({ text: "Can you share your availability for a call?" })).toBe("interview");
    expect(classifyInboundEmail({ text: "Please book a time here: https://calendly.com/acme/30min" })).toBe(
      "interview",
    );
    expect(classifyInboundEmail({ subject: "Interview invitation - Product Manager" })).toBe("interview");
  });

  it("REJECTION WINS over the confirmation language rejections open with", () => {
    expect(
      classifyInboundEmail({
        subject: "Your application to Acme",
        text: "Thank you for applying to Acme. Unfortunately, we will not be moving forward with your application.",
      }),
    ).toBe("rejection");
  });

  it("CONFIRMATION WINS over the interview language confirmations mention", () => {
    expect(
      classifyInboundEmail({
        text: "Thanks for your application! If your profile matches, we will invite you to an interview.",
      }),
    ).toBe("confirmation");
  });

  it("returns unknown rather than guess on unrelated mail", () => {
    expect(classifyInboundEmail({ subject: "Your invoice", text: "Your receipt is attached." })).toBe("unknown");
    expect(classifyInboundEmail({})).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Company/role extraction + fuzzy match
// ---------------------------------------------------------------------------

describe("extractCompanyRole", () => {
  it("reads 'application for X at Y' subjects", () => {
    expect(extractCompanyRole("Your application for the Product Manager role at Acme")).toEqual({
      company: "Acme",
      role: "Product Manager",
    });
  });

  it("reads 'your application to Y' subjects", () => {
    expect(extractCompanyRole("Thank you for your application to Acme!").company).toBe("Acme");
    expect(extractCompanyRole("Fwd: Thank you for applying to Northzone Labs").company).toBe("Northzone Labs");
  });

  it("falls back to the From display name, stripping recruiting cruft", () => {
    const g = extractCompanyRole("Update on your candidacy", '"Acme Hiring Team" <no-reply@greenhouse.io>');
    expect(g.company).toBe("Acme");
  });

  it("returns nulls freely instead of inventing a company", () => {
    expect(extractCompanyRole("Quick update", "no-reply@greenhouse.io")).toEqual({ company: null, role: null });
  });
});

describe("normalizeCompany", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("Acme GmbH")).toBe("acme");
    expect(normalizeCompany("ACME S.L.")).toBe("acme");
  });
});

const app = (id: string, company: string, title: string, status = "applied"): TrackedApp => ({
  id,
  company,
  title,
  status,
});

describe("matchApplication", () => {
  const rows = [
    app("a1", "Acme, Inc.", "Product Manager"),
    app("a2", "Umbrella", "Senior Product Manager"),
    app("a3", "Stark Industries", "Product Manager, Growth"),
  ];

  it("matches on normalized company name", () => {
    expect(matchApplication(rows, { company: "Acme", role: null })?.id).toBe("a1");
    expect(matchApplication(rows, { company: "acme inc", role: null })?.id).toBe("a1");
  });

  it("requires a company signal — role alone never matches", () => {
    expect(matchApplication(rows, { company: null, role: "Product Manager" })).toBeNull();
  });

  it("disambiguates multiple applications at one company by role tokens", () => {
    const multi = [
      app("r1", "Acme", "Product Manager, Payments", "rejected"),
      app("r2", "Acme", "Product Manager, Growth", "applied"),
    ];
    expect(matchApplication(multi, { company: "Acme", role: "Product Manager - Growth" })?.id).toBe("r2");
  });

  it("with no role signal, matches only when exactly one candidate is in flight", () => {
    const multi = [
      app("r1", "Acme", "PM Payments", "rejected"),
      app("r2", "Acme", "PM Growth", "applied"),
    ];
    expect(matchApplication(multi, { company: "Acme", role: null })?.id).toBe("r2");
    const twoLive = [app("r1", "Acme", "PM Payments", "applied"), app("r2", "Acme", "PM Growth", "applied")];
    expect(matchApplication(twoLive, { company: "Acme", role: null })).toBeNull();
  });

  it("returns null for an unknown company rather than fuzzy-stretch", () => {
    expect(matchApplication(rows, { company: "Globex", role: "Product Manager" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decideTransition — THE stale-guard
// ---------------------------------------------------------------------------

describe("decideTransition", () => {
  const now = D("2026-08-11T12:00:00Z");

  it("confirmation stamps confirmed_at, never a status move", () => {
    expect(
      decideTransition({ kind: "confirmation", currentStatus: "applied", emailDate: now, lastChangedAt: null, now }),
    ).toEqual({ action: "confirm" });
    // …even from a later stage: a late-forwarded confirmation must not touch status.
    expect(
      decideTransition({ kind: "confirmation", currentStatus: "interview", emailDate: now, lastChangedAt: null, now }),
    ).toEqual({ action: "confirm" });
  });

  it("interview invite advances applied/responded → interview", () => {
    for (const s of ["applied", "responded"] as const) {
      expect(decideTransition({ kind: "interview", currentStatus: s, emailDate: now, lastChangedAt: null, now })).toEqual(
        { action: "advance", to: "interview" },
      );
    }
  });

  it("interview never downgrades or reopens", () => {
    expect(
      decideTransition({ kind: "interview", currentStatus: "offer", emailDate: now, lastChangedAt: null, now }).action,
    ).toBe("skip");
    expect(
      decideTransition({ kind: "interview", currentStatus: "rejected", emailDate: now, lastChangedAt: null, now }).action,
    ).toBe("skip");
  });

  it("fresh rejection advances applied/responded → rejected", () => {
    expect(
      decideTransition({
        kind: "rejection",
        currentStatus: "applied",
        emailDate: D("2026-08-11T09:00:00Z"),
        lastChangedAt: D("2026-08-01T09:00:00Z"),
        now,
      }),
    ).toEqual({ action: "advance", to: "rejected" });
  });

  it("STALE-GUARD: an old rejection never overwrites a later interview", () => {
    // Rejection email dated BEFORE the move to interview → skip.
    expect(
      decideTransition({
        kind: "rejection",
        currentStatus: "interview",
        emailDate: D("2026-08-05T09:00:00Z"),
        lastChangedAt: D("2026-08-10T09:00:00Z"),
        now,
      }),
    ).toEqual({ action: "skip", reason: "stale rejection never overwrites a later interview" });
    // Same guard protects an offer.
    expect(
      decideTransition({
        kind: "rejection",
        currentStatus: "offer",
        emailDate: D("2026-08-05T09:00:00Z"),
        lastChangedAt: D("2026-08-10T09:00:00Z"),
        now,
      }).action,
    ).toBe("skip");
  });

  it("a rejection PROVABLY newer than the last move may close an interview", () => {
    expect(
      decideTransition({
        kind: "rejection",
        currentStatus: "interview",
        emailDate: D("2026-08-11T09:00:00Z"),
        lastChangedAt: D("2026-08-05T09:00:00Z"),
        now,
      }),
    ).toEqual({ action: "advance", to: "rejected" });
  });

  it("an UNDATED rejection cannot overwrite an interview (no proof = no downgrade)", () => {
    expect(
      decideTransition({
        kind: "rejection",
        currentStatus: "interview",
        emailDate: null,
        lastChangedAt: D("2026-08-05T09:00:00Z"),
        now,
      }).action,
    ).toBe("skip");
    // …but an undated rejection may still close a plain applied card.
    expect(
      decideTransition({ kind: "rejection", currentStatus: "applied", emailDate: null, lastChangedAt: null, now }),
    ).toEqual({ action: "advance", to: "rejected" });
  });

  it(`RECENCY GUARD: a rejection older than ${REJECTION_RECENCY_DAYS} days never flips anything`, () => {
    expect(
      decideTransition({
        kind: "rejection",
        currentStatus: "applied",
        emailDate: D("2026-07-20T09:00:00Z"), // 22 days before `now`
        lastChangedAt: null,
        now,
      }).action,
    ).toBe("skip");
  });

  it("already-rejected and unknown emails are no-ops", () => {
    expect(
      decideTransition({ kind: "rejection", currentStatus: "rejected", emailDate: now, lastChangedAt: null, now })
        .action,
    ).toBe("skip");
    expect(
      decideTransition({ kind: "unknown", currentStatus: "applied", emailDate: now, lastChangedAt: null, now }).action,
    ).toBe("skip");
  });
});

describe("parseResendInboundEvent (#118)", () => {
  // Shape taken verbatim from Resend's receiving documentation. The webhook is
  // METADATA ONLY: no text, no html, no headers. The body must be fetched
  // separately, which is why this returns an emailId rather than a payload.
  const event = {
    type: "email.received",
    created_at: "2026-02-22T23:41:12.126Z",
    data: {
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      created_at: "2026-02-22T23:41:11.894Z",
      from: "Greenhouse <no-reply@greenhouse.io>",
      to: ["u-abc123@northgoing.com"],
      cc: [],
      bcc: [],
      received_for: [],
      message_id: "<111-222-333@email.example.com>",
      subject: "Your application to Acme",
      attachments: [],
    },
  };

  it("maps the documented shape onto the recipient fields the pipeline reads", () => {
    const got = parseResendInboundEvent(event);
    expect(got?.emailId).toBe("56761188-7520-42d8-8898-ff6fc54ce618");
    expect(got?.from).toBe("Greenhouse <no-reply@greenhouse.io>");
    expect(got?.subject).toBe("Your application to Acme");
    expect(got?.messageId).toBe("<111-222-333@email.example.com>");
    expect(extractForwardingToken(got?.to ?? [])).toBe("abc123");
  });

  it("also considers received_for, where a forwarded recipient actually lands", () => {
    // Gmail forwarding puts the mailbox that forwarded in received_for while `to`
    // still names the ORIGINAL recipient. Reading only `to` loses the token and
    // the whole feature silently does nothing.
    const forwarded = {
      ...event,
      data: { ...event.data, to: ["rober@gmail.com"], received_for: ["u-tok9@northgoing.com"] },
    };
    expect(extractForwardingToken(parseResendInboundEvent(forwarded)?.to ?? [])).toBe("tok9");
  });

  it("prefers the message's own date over the delivery timestamp for the stale-guard", () => {
    expect(parseResendInboundEvent(event)?.date).toBe("2026-02-22T23:41:11.894Z");
  });

  it("returns null for any other event type, so a delivery ping cannot drive a tracker", () => {
    expect(parseResendInboundEvent({ ...event, type: "email.delivered" })).toBeNull();
    expect(parseResendInboundEvent({ type: "email.received" })).toBeNull();
    expect(parseResendInboundEvent(null)).toBeNull();
    expect(parseResendInboundEvent({ type: "email.received", data: { from: "x" } })).toBeNull();
  });
});

describe("extractGmailConfirmationLink (the real Gmail flow)", () => {
  // Captured verbatim from the mail Gmail actually sent on 2026-08-19. The design
  // assumed a numeric code in the subject ("(#123456789) Gmail Forwarding
  // Confirmation"). Gmail does not send one: the subject carries no code at all
  // and the body carries a CLICKABLE link instead. Reading the subject for digits
  // therefore always returned null, the code never reached Settings, and setup
  // dead-ended at its first step with nothing broken-looking anywhere.
  const REAL_BODY = [
    "quinterostudio3@gmail.com has requested to automatically forward mail",
    "to your email",
    "address u-cd4b7288dfac41c389c34b0fe78193ce@northgoing.com.",
    "",
    "please click the link below to confirm the request:",
    "",
    "https://mail.google.com/mail/vf-%5BANGjdJ-AzkPg8TYF11_M3_1FQsJ-hpHMV77GQ4n2subtnOSFuiYqfxy7KGXB1-YwXSsL_eKSm9o%5D-8JA0s_VWEX",
    "",
    "If you do not approve of this request, no further action is required.",
    "click this link to cancel this",
    "verification:",
    "https://mail.google.com/mail/uf-%5BANGjdJ8lD5qR5FyuGLKUzxmx1odsM_wMxybG6L9Wa7I%5D-8JA0s_VWEX",
  ].join("\n");

  it("returns the CONFIRM link", () => {
    expect(extractGmailConfirmationLink(REAL_BODY)).toBe(
      "https://mail.google.com/mail/vf-%5BANGjdJ-AzkPg8TYF11_M3_1FQsJ-hpHMV77GQ4n2subtnOSFuiYqfxy7KGXB1-YwXSsL_eKSm9o%5D-8JA0s_VWEX",
    );
  });

  it("never returns the CANCEL link, which sits in the same mail and undoes the setup", () => {
    // The two differ by one letter: /mail/vf- confirms, /mail/uf- cancels. Handing
    // a user the cancel link would silently undo the thing they are trying to do.
    const link = extractGmailConfirmationLink(REAL_BODY);
    expect(link).not.toContain("/mail/uf-");
    expect(link).toContain("/mail/vf-");
  });

  it("finds the link in html mail too, where it arrives inside an anchor", () => {
    const html = '<p>confirm: <a href="https://mail.google.com/mail/vf-%5BABC%5D-XYZ">Confirm</a></p>';
    expect(extractGmailConfirmationLink(html)).toBe("https://mail.google.com/mail/vf-%5BABC%5D-XYZ");
  });

  it("returns null when there is no confirmation link, rather than guessing", () => {
    expect(extractGmailConfirmationLink("no link here")).toBeNull();
    expect(extractGmailConfirmationLink("")).toBeNull();
    expect(extractGmailConfirmationLink(null)).toBeNull();
  });
});

describe("isConfirmUrl (issue #157 — the guard right before the auto-confirm fetch)", () => {
  const VF = "https://mail.google.com/mail/vf-%5BANGjdJ-AzkPg8TYF11%5D-8JA0s_VWEX";
  const UF = "https://mail.google.com/mail/uf-%5BANGjdJ8lD5qR5FyuGLKUzxmx1%5D-8JA0s_VWEX";

  it("accepts the real confirm link", () => {
    expect(isConfirmUrl(VF)).toBe(true);
  });

  it("refuses the cancel link one letter away, even though it is the same host", () => {
    expect(isConfirmUrl(UF)).toBe(false);
  });

  it("refuses a lookalike host", () => {
    expect(isConfirmUrl("https://mail.google.com.evil.example/mail/vf-x")).toBe(false);
    expect(isConfirmUrl("https://evil-mail.google.com/mail/vf-x")).toBe(false);
    expect(isConfirmUrl("https://not-google.com/mail/vf-x")).toBe(false);
  });

  it("refuses a non-https scheme and an unparseable or empty value", () => {
    expect(isConfirmUrl("http://mail.google.com/mail/vf-x")).toBe(false);
    expect(isConfirmUrl("not a url")).toBe(false);
    expect(isConfirmUrl("")).toBe(false);
    expect(isConfirmUrl(null)).toBe(false);
    expect(isConfirmUrl(undefined)).toBe(false);
  });
});

describe("isGmailConfirmSuccess (reading the fetch that follows the confirm link)", () => {
  it("is true on a 200 with an ordinary confirmation page", () => {
    expect(isGmailConfirmSuccess(200, "<html>Forwarding confirmed. You're all set.</html>")).toBe(true);
  });

  it("is false on a 200 whose body reads like Gmail rejected the link", () => {
    expect(isGmailConfirmSuccess(200, "This link has expired.")).toBe(false);
    expect(isGmailConfirmSuccess(200, "Invalid request.")).toBe(false);
    expect(isGmailConfirmSuccess(200, "An error occurred.")).toBe(false);
  });

  it("is false on any non-200, whatever the body says", () => {
    expect(isGmailConfirmSuccess(500, "confirmed")).toBe(false);
    expect(isGmailConfirmSuccess(403, "confirmed")).toBe(false);
  });

  it("matches the reject words on boundaries only, so a substring like 'onerror' in page script doesn't false-reject a real confirmation", () => {
    expect(
      isGmailConfirmSuccess(200, "<script>window.onerror=function(){};</script>Forwarding confirmed."),
    ).toBe(true);
  });
});

describe("forwardingStatus (the Settings live status line, 4 states)", () => {
  it("is none before a token row exists", () => {
    expect(forwardingStatus(null)).toBe("none");
    expect(forwardingStatus(undefined)).toBe("none");
  });

  it("is created once the row exists but Gmail hasn't sent a confirmation yet", () => {
    expect(forwardingStatus({ gmail_confirmation_url: null, gmail_confirmation_code: null, gmail_confirmed_at: null })).toBe(
      "created",
    );
  });

  it("is received once either shape of the confirmation mail landed", () => {
    expect(
      forwardingStatus({ gmail_confirmation_url: "https://mail.google.com/mail/vf-x", gmail_confirmation_code: null, gmail_confirmed_at: null }),
    ).toBe("received");
    expect(forwardingStatus({ gmail_confirmation_url: null, gmail_confirmation_code: "123456789", gmail_confirmed_at: null })).toBe(
      "received",
    );
  });

  it("is confirmed once the server auto-confirmed it, even if the link is still on the row", () => {
    expect(
      forwardingStatus({
        gmail_confirmation_url: "https://mail.google.com/mail/vf-x",
        gmail_confirmation_code: null,
        gmail_confirmed_at: "2026-08-27T10:00:00Z",
      }),
    ).toBe("confirmed");
  });
});
