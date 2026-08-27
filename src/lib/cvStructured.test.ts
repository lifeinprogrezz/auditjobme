import { describe, it, expect } from "vitest";
import {
  buildCvParsePrompt,
  coerceCvStructured,
  isCvStructuredUsable,
  normalizeForAts,
  parseCvResponse,
  readCvStructured,
  validateCvStructured,
  CV_LIMITS,
} from "./cvStructured";

// A CV as the extractor now hands it over: real lines, not one flattened paragraph.
const CV = `Jane Doe
jane@example.com | +34 600 111 222 | Barcelona, Spain
linkedin.com/in/janedoe

Professional Summary
Product manager who ships consumer products.

Professional Experience

Acme Corp
Product Manager
09/2021 - Present | Barcelona, Spain
- Grew activation 40% by shipping an onboarding redesign
- Led a team of 5 engineers

Education
University of Vigo
Bachelor in Business Administration
09/2015 - 06/2020 | Vigo, Spain

Skills
Languages: Spanish, English`;

/** What an honest parse of the CV above returns. */
const HONEST = {
  contact: {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+34 600 111 222",
    location: "Barcelona, Spain",
    links: ["linkedin.com/in/janedoe"],
  },
  summary: "Product manager who ships consumer products.",
  experience: [
    {
      company: "Acme Corp",
      role: "Product Manager",
      start: "09/2021",
      end: "Present",
      location: "Barcelona, Spain",
      bullets: ["Grew activation 40% by shipping an onboarding redesign", "Led a team of 5 engineers"],
    },
  ],
  education: [
    {
      school: "University of Vigo",
      degree: "Bachelor in Business Administration",
      start: "09/2015",
      end: "06/2020",
      location: "Vigo, Spain",
    },
  ],
  skills: [{ group: "Languages", items: ["Spanish", "English"] }],
  extras: [],
};

describe("validateCvStructured — cite or refuse", () => {
  it("accepts an honest parse whole: nothing dropped, every field kept", () => {
    const { cv, drops, dropped } = validateCvStructured(HONEST, CV);
    expect(drops).toBe(0);
    expect(dropped).toEqual([]);
    expect(cv.contact.name).toBe("Jane Doe");
    expect(cv.experience[0].bullets).toEqual([
      "Grew activation 40% by shipping an onboarding redesign",
      "Led a team of 5 engineers",
    ]);
    expect(cv.experience[0].start).toBe("09/2021");
    expect(cv.experience[0].end).toBe("Present");
    expect(cv.education[0].end).toBe("06/2020");
    expect(cv.skills[0]).toEqual({ group: "Languages", items: ["Spanish", "English"] });
  });

  it("DROPS an invented bullet and counts it, keeping the real ones", () => {
    const invented = structuredClone(HONEST);
    invented.experience[0].bullets = [
      "Grew activation 40% by shipping an onboarding redesign",
      "Raised a 10 million Series A round", // nowhere in the CV
    ];
    const { cv, drops, dropped } = validateCvStructured(invented, CV);
    expect(cv.experience[0].bullets).toEqual(["Grew activation 40% by shipping an onboarding redesign"]);
    expect(drops).toBe(1);
    expect(dropped[0]).toContain("bullet not in the CV");
  });

  it("DROPS a date the CV never states, and keeps the job it belongs to", () => {
    const wrongDate = structuredClone(HONEST);
    wrongDate.experience[0].start = "01/2017";
    const { cv, drops, dropped } = validateCvStructured(wrongDate, CV);
    expect(cv.experience[0].start).toBe("");
    expect(cv.experience[0].end).toBe("Present");
    expect(cv.experience[0].bullets).toHaveLength(2);
    expect(drops).toBe(1);
    expect(dropped[0]).toContain("date not in the CV");
  });

  it("a reworded bullet is an invented bullet: near enough is still refused", () => {
    const reworded = structuredClone(HONEST);
    reworded.experience[0].bullets = ["Grew activation by 40% through an onboarding redesign"];
    const { cv, drops } = validateCvStructured(reworded, CV);
    expect(cv.experience[0].bullets).toEqual([]);
    expect(drops).toBe(1);
  });

  it("matching ignores whitespace, case and typographic dashes, so a real line is never refused", () => {
    const spaced = structuredClone(HONEST);
    spaced.experience[0].bullets = ["grew   activation 40%\nby shipping an onboarding redesign"];
    const { cv, drops } = validateCvStructured(spaced, CV);
    expect(drops).toBe(0);
    expect(cv.experience[0].bullets).toHaveLength(1);
  });

  it("refuses garbage shapes without throwing, and drops a role with no company and no title", () => {
    expect(validateCvStructured(null, CV).cv.experience).toEqual([]);
    expect(validateCvStructured("nope", CV).cv.contact.name).toBe("");
    const junk = { experience: [{ bullets: ["Led a team of 5 engineers"] }, "not an object"] };
    expect(validateCvStructured(junk, CV).cv.experience).toEqual([]);
  });

  it("bounds every list, so one odd parse cannot produce a runaway document", () => {
    const many = {
      experience: Array.from({ length: 40 }, () => ({ company: "Acme Corp", role: "Product Manager", bullets: [] })),
      extras: Array.from({ length: 50 }, (_, i) => `line ${i}`),
    };
    const { cv } = validateCvStructured(many, CV);
    expect(cv.experience).toHaveLength(CV_LIMITS.experience);
    expect(cv.extras).toHaveLength(CV_LIMITS.extras);
  });
});

// The owner's one layout choice (#150 follow-up). The parse must keep mirroring the
// CV, so this flag is never set by the parser: it only ever comes back from the editor.
describe("groupedIntoPrevious — the owner's grouping flag", () => {
  /** Two entries, both real in the CV above, so grounding never gets in the way. */
  const twoJobs = (grouped?: boolean) => ({
    ...HONEST,
    experience: [
      HONEST.experience[0],
      {
        company: "Acme Corp",
        role: "Product Manager",
        start: "",
        end: "",
        bullets: ["Led a team of 5 engineers"],
        ...(grouped === undefined ? {} : { groupedIntoPrevious: grouped }),
      },
    ],
  });

  it("round-trips a flagged entry through validate, storage and the read back", () => {
    const validated = validateCvStructured(twoJobs(true), CV).cv;
    expect(validated.experience[1].groupedIntoPrevious).toBe(true);
    const read = readCvStructured(JSON.parse(JSON.stringify(validated)));
    expect(read?.experience[1].groupedIntoPrevious).toBe(true);
  });

  it("leaves an unflagged structure exactly as it was: the field is absent, not false", () => {
    const validated = validateCvStructured(twoJobs(), CV).cv;
    expect("groupedIntoPrevious" in validated.experience[1]).toBe(false);
    // An explicit false is the same thing as no flag at all, and is stored as no flag.
    const explicitlyFalse = validateCvStructured(twoJobs(false), CV).cv;
    expect(JSON.stringify(explicitlyFalse)).toBe(JSON.stringify(validated));
  });

  it("IGNORES the flag on the first entry: there is nothing above it to join", () => {
    const first = { ...HONEST, experience: [{ ...HONEST.experience[0], groupedIntoPrevious: true }] };
    const validated = validateCvStructured(first, CV).cv;
    expect(validated.experience[0].groupedIntoPrevious).toBeUndefined();
    // Same on the way back out of the database, so a stale row cannot revive it.
    const stored = readCvStructured({ ...validated, experience: [{ ...validated.experience[0], groupedIntoPrevious: true }] });
    expect(stored?.experience[0].groupedIntoPrevious).toBeUndefined();
  });

  it("takes only a real true, never a truthy string or a number", () => {
    const junk = {
      ...HONEST,
      experience: [HONEST.experience[0], { ...twoJobs(true).experience[1], groupedIntoPrevious: "yes" }],
    };
    expect(coerceCvStructured(junk).experience[1].groupedIntoPrevious).toBeUndefined();
  });

  it("never asks the model for it: the parse prompt has no grouping field", () => {
    expect(buildCvParsePrompt(CV)).not.toContain("groupedIntoPrevious");
  });
});

describe("reading a stored structure", () => {
  it("keeps dates on the way back out (they were grounded before they were written)", () => {
    const stored = validateCvStructured(HONEST, CV).cv;
    const read = readCvStructured(JSON.parse(JSON.stringify(stored)));
    expect(read?.experience[0].start).toBe("09/2021");
    expect(read?.education[0].start).toBe("09/2015");
  });

  it("returns null for anything too thin to render, so the caller keeps the text path", () => {
    expect(readCvStructured(null)).toBeNull();
    expect(readCvStructured({})).toBeNull();
    expect(readCvStructured({ contact: { name: "Jane Doe" } })).toBeNull();
    expect(isCvStructuredUsable(coerceCvStructured(HONEST))).toBe(true);
  });
});

describe("parseCvResponse", () => {
  it("finds the JSON inside a chatty response and validates it", () => {
    const raw = `Here you go:\n\n${JSON.stringify(HONEST)}\n\nHope that helps.`;
    const result = parseCvResponse(raw, CV);
    expect(result?.cv.contact.name).toBe("Jane Doe");
    expect(result?.drops).toBe(0);
  });

  it("returns null when there is no JSON, or the JSON is broken", () => {
    expect(parseCvResponse("I could not read that", CV)).toBeNull();
    expect(parseCvResponse("{ not json ", CV)).toBeNull();
  });
});

describe("normalizeForAts", () => {
  it("replaces the typographic characters that confuse tracking systems", () => {
    expect(normalizeForAts("a\u2014b\u2013c")).toBe("a-b-c");
    expect(normalizeForAts("\u201Cquote\u201D and \u2018single\u2019")).toBe('"quote" and \'single\'');
    expect(normalizeForAts("more\u2026")).toBe("more...");
    expect(normalizeForAts("no\u200Bzero\uFEFFwidth")).toBe("nozerowidth");
    expect(normalizeForAts("hard\u00A0space")).toBe("hard space");
  });
});

describe("the parse prompt", () => {
  it("carries the CV and tells the model it is a parser, not a writer", () => {
    const p = buildCvParsePrompt(CV);
    expect(p).toContain("Grew activation 40%");
    expect(p).toContain("COPY, never compose");
    expect(p).toContain("Never invent");
    expect(p).toContain('"experience"');
  });
});
