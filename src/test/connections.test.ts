// Pins the warm-contacts pure logic (issue #41): parsing the user's own LinkedIn
// Connections.csv export, and the company-name matching that turns those rows into
// "You know N people here" on a job card. Two invariants matter:
//   1. The parser must survive the REAL file LinkedIn ships — a multi-line quoted
//      "Notes:" preamble before the header, quoted commas, doubled quotes — and
//      map columns by NAME so a reordered export doesn't shift every field.
//   2. Matching is by normalized company key, conservative: legal-form suffixes
//      fold ("Spotify AB" = "Spotify") but distinct companies never merge.
// There is deliberately NO score plumbing to pin here: the match is information
// on the card, never a ranking boost (recorded in issue #41).
import { describe, it, expect } from "vitest";
import {
  parseConnectionsCsv,
  companyKey,
  buildWarmIndex,
  warmContactsFor,
  warmMarkerLabel,
  type WarmContact,
} from "@/lib/connections";

// The shape LinkedIn actually exports: a quoted multi-line Notes preamble, a blank
// line, then the header. Field order as shipped in 2025/2026 exports.
const REAL_SHAPE = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed it.',
  '"',
  "",
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "Jane,Doe,https://www.linkedin.com/in/janedoe,,Spotify AB,Product Manager,07 Mar 2021",
  'John,"O""Brien",https://www.linkedin.com/in/jobrien,,"Acme, Inc.",Head of Product,12 Jan 2020',
  "Nora,Nilsson,https://www.linkedin.com/in/noranilsson,,,Freelance,01 Feb 2019",
  "María,García,https://www.linkedin.com/in/mariagarcia,,Glovo,Senior PM,15 Jun 2022",
].join("\r\n");

describe("parseConnectionsCsv", () => {
  it("parses the real LinkedIn shape: notes preamble, quoted fields, CRLF", () => {
    const rows = parseConnectionsCsv(REAL_SHAPE);
    expect(rows).toHaveLength(3); // Nora has no company — skipped
    expect(rows[0]).toEqual({
      fullName: "Jane Doe",
      company: "Spotify AB",
      companyKey: "spotify",
      position: "Product Manager",
      linkedinUrl: "https://www.linkedin.com/in/janedoe",
      connectedOn: "07 Mar 2021",
    });
  });

  it("keeps a quoted comma and a doubled quote inside a field", () => {
    const rows = parseConnectionsCsv(REAL_SHAPE);
    const john = rows.find((r) => r.fullName === 'John O"Brien');
    expect(john).toBeTruthy();
    expect(john?.company).toBe("Acme, Inc.");
    expect(john?.companyKey).toBe("acme");
  });

  it("maps columns by name, so a reordered export still parses", () => {
    const reordered = [
      "Company,Position,First Name,Last Name,URL,Connected On",
      "Klarna,Staff PM,Erik,Berg,https://www.linkedin.com/in/erikberg,03 Apr 2023",
    ].join("\n");
    const rows = parseConnectionsCsv(reordered);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Erik Berg");
    expect(rows[0].company).toBe("Klarna");
    expect(rows[0].position).toBe("Staff PM");
  });

  it("returns [] for a file that is not a Connections.csv", () => {
    expect(parseConnectionsCsv("this,is,not\nthe,right,file")).toEqual([]);
    expect(parseConnectionsCsv("")).toEqual([]);
  });

  it("drops a non-URL in the URL column instead of rendering a broken link", () => {
    const csv = ["First Name,Last Name,URL,Company,Position,Connected On", "A,B,not a url,Acme,PM,01 Jan 2024"].join(
      "\n",
    );
    expect(parseConnectionsCsv(csv)[0].linkedinUrl).toBeNull();
  });

  it("skips rows with a company but no name", () => {
    const csv = ["First Name,Last Name,URL,Company,Position,Connected On", ",,https://x.example,Acme,PM,01 Jan 2024"].join(
      "\n",
    );
    expect(parseConnectionsCsv(csv)).toEqual([]);
  });
});

describe("companyKey", () => {
  it("folds case, punctuation and diacritics", () => {
    expect(companyKey("  N26  ")).toBe("n26");
    expect(companyKey("Glovo")).toBe(companyKey("GLOVO"));
    expect(companyKey("Télécom París")).toBe("telecom paris");
  });

  it("strips trailing legal-form suffixes, repeatedly", () => {
    expect(companyKey("Spotify AB")).toBe("spotify");
    expect(companyKey("Zalando SE")).toBe("zalando");
    expect(companyKey("Acme Holding GmbH")).toBe("acme");
    expect(companyKey("Personio GmbH & Co. KG")).toBe("personio");
  });

  it("strips a leading 'the' so both sides of the match agree", () => {
    expect(companyKey("The Trade Desk")).toBe("trade desk");
  });

  it("never merges distinct companies or empties a name made of suffix words", () => {
    expect(companyKey("Google")).not.toBe(companyKey("Google Cloud"));
    expect(companyKey("Limited")).toBe("limited");
    expect(companyKey("SE")).toBe("se");
  });

  it("normalizes ampersands the same on both sides", () => {
    expect(companyKey("H&M")).toBe(companyKey("H & M"));
  });
});

describe("warm index + lookup", () => {
  const contacts: WarmContact[] = [
    { fullName: "Jane Doe", company: "Spotify AB", companyKey: companyKey("Spotify AB"), position: "PM", linkedinUrl: null },
    { fullName: "Ana Ruiz", company: "Spotify", companyKey: companyKey("Spotify"), position: null, linkedinUrl: null },
    { fullName: "Erik Berg", company: "Klarna", companyKey: companyKey("Klarna"), position: "Staff PM", linkedinUrl: null },
  ];

  it("groups by key and answers a job-row company name", () => {
    const index = buildWarmIndex(contacts);
    expect(warmContactsFor("Spotify", index).map((c) => c.fullName)).toEqual(["Jane Doe", "Ana Ruiz"]);
    expect(warmContactsFor("Klarna", index)).toHaveLength(1);
    expect(warmContactsFor("Revolut", index)).toEqual([]);
  });

  it("is empty-safe: no upload means no marker anywhere", () => {
    expect(warmContactsFor("Spotify", buildWarmIndex([]))).toEqual([]);
  });
});

describe("warmMarkerLabel", () => {
  it("says nothing for zero, singular for one, a count above that", () => {
    expect(warmMarkerLabel(0)).toBeNull();
    expect(warmMarkerLabel(1)).toBe("You know 1 person here");
    expect(warmMarkerLabel(3)).toBe("You know 3 people here");
  });
});
