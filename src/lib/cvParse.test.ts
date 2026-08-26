// Pins the two money-and-truth rules around the structured CV parse (#150).
//
// The parse is a PAID call on a page that loads on every visit, and the thing it
// writes is printed on someone's CV. So two failures matter more than the feature:
//
//   1. Rendering a structure that belongs to an OLDER CV. Silent, and wrong on paper.
//   2. Buying the same parse on every Settings and Apply load, forever.
//
// Everything here is about those two. The schema and the grounding validator are
// pinned separately in cvStructured.test.ts.
import { describe, it, expect, beforeEach, vi } from "vitest";

const maybeSingle = vi.fn();
const update = vi.fn();
const callProxy = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => update(values),
      }),
    }),
  },
}));

vi.mock("./tailor", () => ({
  callProxy: (...args: unknown[]) => callProxy(...args),
}));

import {
  ensureCvStructured,
  parseAndSaveCv,
  readCvStructuredState,
  CV_STRUCTURED_CLEAR,
  isMissingCvStructuredColumn,
} from "./cvParse";

const CV_TEXT = [
  "Jane Doe",
  "EXPERIENCE",
  "Acme Corp - Product Manager, 09/2021 - Present",
  "Grew activation 40% in two quarters",
].join("\n");

/** A parse response the validator accepts: every bullet and date is in CV_TEXT. */
const GOOD_PARSE = JSON.stringify({
  contact: { name: "Jane Doe", links: [] },
  summary: "",
  experience: [
    {
      company: "Acme Corp",
      role: "Product Manager",
      start: "09/2021",
      end: "Present",
      bullets: ["Grew activation 40% in two quarters"],
    },
  ],
  education: [],
  skills: [],
  extras: [],
});

/** Well-formed, and empty: nothing renderable comes out of it. */
const THIN_PARSE = JSON.stringify({ contact: { name: "Jane Doe", links: [] }, experience: [], education: [] });

const OLD = "2026-08-01T10:00:00.000Z";
const NEW = "2026-08-20T10:00:00.000Z";

/** The row the profiles select returns. Anything omitted is null. */
function row(values: Record<string, unknown>) {
  maybeSingle.mockResolvedValue({
    data: { cv_structured: null, cv_structured_at: null, cv_changed_at: null, ...values },
    error: null,
  });
}

const STORED = JSON.parse(GOOD_PARSE);

describe("cvParse: never render a structure that belongs to an older CV", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    update.mockReset().mockResolvedValue({ error: null });
    callProxy.mockReset().mockResolvedValue(GOOD_PARSE);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns a structure parsed after the CV last changed", async () => {
    row({ cv_structured: STORED, cv_structured_at: NEW, cv_changed_at: OLD });
    const cv = await ensureCvStructured("u1", CV_TEXT);
    expect(cv?.experience[0].company).toBe("Acme Corp");
    expect(callProxy).not.toHaveBeenCalled();
  });

  it("refuses a structure parsed BEFORE the CV changed, and re-parses instead", async () => {
    // The exact shape of a re-parse that never landed: new cv_text, old structure.
    row({ cv_structured: { ...STORED, contact: { name: "Someone Else", links: [] } }, cv_structured_at: OLD, cv_changed_at: NEW });
    const cv = await ensureCvStructured("u1", CV_TEXT);
    expect(cv?.contact.name).toBe("Jane Doe"); // the fresh parse, never the stale row
    expect(callProxy).toHaveBeenCalledTimes(1);
  });

  it("treats a row cleared by a CV upload as unparsed", async () => {
    row({ ...CV_STRUCTURED_CLEAR, cv_changed_at: NEW });
    const state = await readCvStructuredState("u1");
    expect(state).toEqual({ cv: null, attempted: false, failed: false });
  });

  it("accepts a stamped structure on a legacy row that has no cv_changed_at", async () => {
    row({ cv_structured: STORED, cv_structured_at: OLD, cv_changed_at: null });
    expect((await ensureCvStructured("u1", CV_TEXT))?.experience).toHaveLength(1);
    expect(callProxy).not.toHaveBeenCalled();
  });
});

describe("cvParse: decide once, never re-buy the parse on every visit", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    update.mockReset().mockResolvedValue({ error: null });
    callProxy.mockReset().mockResolvedValue(GOOD_PARSE);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does NOT parse when the read fails (pre-migration unknown column)", async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: `column profiles.cv_structured does not exist` },
    });
    expect(await ensureCvStructured("u1", CV_TEXT)).toBeNull();
    // The parse could not be stored, so buying it would repeat on every visit.
    expect(callProxy).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does NOT re-parse when a parse already ran and stored nothing renderable", async () => {
    row({ cv_structured: null, cv_structured_at: NEW, cv_changed_at: OLD });
    expect(await ensureCvStructured("u1", CV_TEXT)).toBeNull();
    expect(callProxy).not.toHaveBeenCalled();
  });

  it("does NOT re-parse when the stored structure is too thin to render", async () => {
    // readCvStructured returns null for this, which is exactly the value that used
    // to look identical to "never parsed" and bought a call on every page load.
    row({ cv_structured: { experience: [], education: [] }, cv_structured_at: NEW, cv_changed_at: OLD });
    expect(await ensureCvStructured("u1", CV_TEXT)).toBeNull();
    expect(callProxy).not.toHaveBeenCalled();
  });

  it("stamps the attempt when the parse comes back too thin to render", async () => {
    callProxy.mockResolvedValue(THIN_PARSE);
    row({ cv_changed_at: OLD });
    expect(await parseAndSaveCv("u1", CV_TEXT)).toBeNull();
    // The write is what closes the loop: cv_structured_at is set even though there
    // is nothing worth rendering, so the next visit reads "already tried".
    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof written.cv_structured_at).toBe("string");
  });

  it("stamps the attempt when the model returns nothing parseable at all", async () => {
    // No JSON in the response, so there is no structure to write — but the call was
    // made and paid for, and an unstamped row buys it again on the next page load.
    callProxy.mockResolvedValue("I am sorry, I cannot help with that.");
    row({ cv_changed_at: OLD });
    expect(await parseAndSaveCv("u1", CV_TEXT)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(written.cv_structured).toBeNull();
    expect(typeof written.cv_structured_at).toBe("string");
  });

  it("parses exactly once for a CV that has never been parsed", async () => {
    row({ cv_changed_at: OLD });
    const cv = await ensureCvStructured("u1", CV_TEXT);
    expect(cv?.experience[0].bullets).toEqual(["Grew activation 40% in two quarters"]);
    expect(callProxy).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does NOT stamp when the call itself failed, so an outage can recover", async () => {
    callProxy.mockRejectedValue(new Error("anthropic-proxy 503"));
    row({ cv_changed_at: OLD });
    expect(await parseAndSaveCv("u1", CV_TEXT)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("isMissingCvStructuredColumn", () => {
  it("recognises the pre-migration write failure and nothing else", () => {
    expect(isMissingCvStructuredColumn("Could not find the 'cv_structured' column of 'profiles'")).toBe(true);
    expect(isMissingCvStructuredColumn('column "cv_structured_at" of relation "profiles" does not exist')).toBe(true);
    expect(isMissingCvStructuredColumn("new row violates row-level security policy")).toBe(false);
    expect(isMissingCvStructuredColumn(null)).toBe(false);
  });
});
