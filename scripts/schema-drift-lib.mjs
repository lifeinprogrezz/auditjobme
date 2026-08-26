// Pure compare for the schema drift check (issue #132). No I/O, no network.
//
// A snapshot is the JSON that public.schema_snapshot() returns (migration
// 20260826150000): one array per section, one object per catalog row. This
// module answers one question — do two snapshots describe the same schema —
// and reports every difference as a line a person can act on. Row order never
// matters: rows are matched by identity (see keyOf), and a section absent
// from one side reads as empty.
//
// Pinned by src/test/schema-drift-lib.test.ts. scripts/schema-drift-check.mjs
// is the only caller.

export const SNAPSHOT_SECTIONS = Object.freeze([
  "tables",
  "columns",
  "constraints",
  "indexes",
  "policies",
  "functions",
  "triggers",
  "views",
]);

/** Identity of one catalog row inside its section. */
function keyOf(section, row) {
  if (section === "functions") return `${row.name}(${row.args ?? ""})`;
  if (row.table !== undefined) return `${row.table}.${row.name}`;
  return String(row.name);
}

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function show(v) {
  return v === undefined || v === null ? "null" : JSON.stringify(v);
}

function sortedKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

/**
 * Stable form of a snapshot for committing: sections in SNAPSHOT_SECTIONS order,
 * rows sorted by identity, keys sorted inside each row. Two snapshots of the
 * same schema then serialise byte-identical, whatever key order the database
 * returned, so a refresh shows a real change or no change at all.
 */
export function canonicalSnapshot(snapshot) {
  const out = {};
  for (const section of SNAPSHOT_SECTIONS) {
    const rows = (snapshot?.[section] ?? []).map(sortedKeys);
    rows.sort((a, b) => keyOf(section, a).localeCompare(keyOf(section, b)));
    out[section] = rows;
  }
  return out;
}

/**
 * Compare two snapshots. Returns one line per drift item, empty when equal.
 *   "- <section> <key>: in snapshot, not in live"
 *   "+ <section> <key>: in live, not in snapshot"
 *   "~ <section> <key>: <field> snapshot=<a> live=<b>"
 */
export function diffSchemaSnapshots(snapshot, live) {
  const out = [];
  for (const section of SNAPSHOT_SECTIONS) {
    const want = new Map((snapshot?.[section] ?? []).map((r) => [keyOf(section, r), r]));
    const have = new Map((live?.[section] ?? []).map((r) => [keyOf(section, r), r]));
    const keys = [...new Set([...want.keys(), ...have.keys()])].sort();
    for (const key of keys) {
      const a = want.get(key);
      const b = have.get(key);
      if (!b) {
        out.push(`- ${section} ${key}: in snapshot, not in live`);
        continue;
      }
      if (!a) {
        out.push(`+ ${section} ${key}: in live, not in snapshot`);
        continue;
      }
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const f of fields) {
        if (!same(a[f], b[f])) {
          out.push(`~ ${section} ${key}: ${f} snapshot=${show(a[f])} live=${show(b[f])}`);
        }
      }
    }
  }
  return out;
}
