// Warm contacts from the user's OWN LinkedIn connections export (issue #41).
//
// LinkedIn lets every member download their first-degree connections as a small
// CSV file (Connections.csv). This module is the pure half of that feature: parse
// the file, normalize company names into a matching key, and answer "who do I
// know at this company?" for the Today cards and the Apply page panel.
//
// Two decisions worth pinning in prose:
// - PRIVACY POSTURE: the export is the user's own data about their own network,
//   handled exactly like the CV — stored server-side in an own-row RLS table
//   (migration 20260811220000_connections.sql), included in the account export
//   and the account delete (USER_DATA_TABLES in src/lib/account.ts). Nothing here
//   ever contacts anyone, and nothing is shared between users.
// - NO SCORE CHANGE, deliberately: the personal career-ops engine applies a +0.3
//   boost where a first-degree connection exists; the product does NOT (recorded
//   in issue #41 so nobody "fixes" it later). A mediocre role must not climb
//   because the user happens to know somebody there. Knowing someone is
//   information on the card, never a thumb on the ranking scale.
//
// Pinned by src/test/connections.test.ts.

export type ParsedConnection = {
  fullName: string;
  company: string;
  companyKey: string;
  position: string | null;
  linkedinUrl: string | null;
  connectedOn: string | null;
};

/** A stored connection as the warm surfaces consume it. */
export type WarmContact = {
  fullName: string;
  company: string;
  companyKey: string;
  position: string | null;
  linkedinUrl: string | null;
};

/**
 * Legal-form suffixes stripped from the END of a company name when building the
 * matching key, so "Spotify AB" and "Spotify" meet on the same key. Suffix
 * position only — "SE" in "Zalando SE" strips, "se" as a real word elsewhere
 * doesn't. Conservative on purpose: descriptive words ("labs", "technologies")
 * stay, because stripping them would merge genuinely different companies.
 */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "llp", "plc", "co", "corp",
  "corporation", "company", "gmbh", "ag", "kg", "ug", "se", "ev",
  "sa", "sas", "sasu", "sarl", "srl", "sl", "slu", "sau", "sccl",
  "bv", "nv", "ab", "as", "asa", "aps", "oy", "oyj", "spa", "sp", "zoo",
  "gruppe", "group", "holding", "holdings",
]);

/**
 * Normalize a company name into the key both sides of the match use: the user's
 * connection rows on one side, a job row's `company` string on the other.
 * Lowercase, diacritics folded, punctuation dropped, trailing legal suffixes
 * stripped (repeatedly: "Acme Holding GmbH" → "acme"), a leading "the" dropped.
 * Never strips a name down to nothing — "Limited" the company keeps its word.
 */
export function companyKey(name: string): string {
  const folded = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks left by NFKD (é → e)
    .replace(/[^a-z0-9]+/g, " ") // "&" folds to a space, same on both sides
    .trim();
  let words = folded.split(" ").filter(Boolean);
  if (words.length > 1 && words[0] === "the") words = words.slice(1);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words = words.slice(0, -1);
  }
  return words.join(" ");
}

/** Split CSV text into records of fields, RFC 4180 style: quoted fields may hold
 *  commas, doubled quotes and real newlines (LinkedIn's notes preamble does). */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Parse a LinkedIn Connections.csv export into connection rows.
 *
 * Robust to the real file's quirks: LinkedIn prepends a multi-line "Notes:"
 * preamble before the header, so the header row is FOUND (the first record
 * carrying both "First Name" and "Company"), never assumed to be line one; and
 * columns are mapped by NAME, not position, so a column-order change doesn't
 * silently shift every field. Rows without a company are skipped — the whole
 * point of the upload is matching companies, and LinkedIn leaves the field
 * empty for people who haven't listed one.
 *
 * Returns [] when no header can be found (i.e. this isn't a Connections.csv).
 */
export function parseConnectionsCsv(text: string): ParsedConnection[] {
  const records = csvRecords(text);
  const headerIdx = records.findIndex((r) => {
    const cols = r.map(norm);
    return cols.includes("first name") && cols.includes("company");
  });
  if (headerIdx === -1) return [];
  const header = records[headerIdx].map(norm);
  const col = (name: string) => header.indexOf(name);
  const iFirst = col("first name");
  const iLast = col("last name");
  const iUrl = col("url");
  const iCompany = col("company");
  const iPosition = col("position");
  const iConnected = col("connected on");

  const at = (r: string[], i: number): string => (i >= 0 && i < r.length ? r[i].trim() : "");

  const out: ParsedConnection[] = [];
  for (const r of records.slice(headerIdx + 1)) {
    const company = at(r, iCompany);
    const fullName = [at(r, iFirst), at(r, iLast)].filter(Boolean).join(" ");
    if (!company || !fullName) continue;
    const key = companyKey(company);
    if (!key) continue;
    const url = at(r, iUrl);
    out.push({
      fullName,
      company,
      companyKey: key,
      position: at(r, iPosition) || null,
      linkedinUrl: /^https?:\/\//i.test(url) ? url : null,
      connectedOn: at(r, iConnected) || null,
    });
  }
  return out;
}

/** Index stored connections by company key — the lookup every card row makes. */
export function buildWarmIndex(contacts: readonly WarmContact[]): Map<string, WarmContact[]> {
  const index = new Map<string, WarmContact[]>();
  for (const c of contacts) {
    const list = index.get(c.companyKey) ?? [];
    list.push(c);
    index.set(c.companyKey, list);
  }
  return index;
}

/** The user's first-degree connections at this company (by a job row's company name). */
export function warmContactsFor(
  company: string,
  index: Map<string, WarmContact[]>,
): WarmContact[] {
  if (index.size === 0) return [];
  return index.get(companyKey(company)) ?? [];
}

/** The card marker's line: null when there is nobody to mention. */
export function warmMarkerLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "You know 1 person here" : `You know ${count} people here`;
}
