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
  extractGmailConfirmationCode,
  forwardingAddress,
  isGmailForwardingConfirmation,
  matchApplication,
  normalizeCompany,
  REJECTION_RECENCY_DAYS,
  secretAuthResult,
  senderDomain,
  type TrackedApp,
} from "@/lib/inbound";

const D = (iso: string) => new Date(iso);

describe("extractForwardingToken", () => {
  it("parses the bare address", () => {
    expect(extractForwardingToken("u-abc123@track.auditjob.me")).toBe("abc123");
  });

  it("parses display-name and list forms, case-insensitively", () => {
    expect(extractForwardingToken('"Me" <U-DEF456@Track.AuditJob.Me>')).toBe("def456");
    expect(extractForwardingToken(["other@example.com", "u-tok9@track.auditjob.me"])).toBe("tok9");
  });

  it("returns null for other domains and malformed recipients — never guesses", () => {
    expect(extractForwardingToken("u-abc@track.evil.me")).toBeNull();
    expect(extractForwardingToken("someone@auditjob.me")).toBeNull();
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
