// Pins the account export (issue #84, launch gate). Two things matter and neither is
// obvious from reading the code: the export has to cover EVERY table keyed to a user
// (a missed one means we hand somebody a file we call "everything" and it isn't), and
// it must refuse to hand over a partial file when a read fails.
//
// The first test reads supabase/migrations/ directly, the same way
// api-esm-imports.test.ts reads api/: a future migration that adds a user table
// fails here until it is added to USER_DATA_TABLES, which is also what drives the
// deletion copy. The database half of the promise is pinned in
// supabase/tests/assert_rls.sql (CI job "migrations + RLS check").
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  USER_DATA_TABLES,
  buildAccountExport,
  accountExportFilename,
  accountExportText,
  ACCOUNT_EXPORT_FORMAT,
  type ExportClient,
  type ExportRow,
} from "@/lib/account";

/** Every public table a migration creates with a user identifier on it. */
function userKeyedTablesInMigrations(): Map<string, string> {
  const dir = join(process.cwd(), "supabase", "migrations");
  const found = new Map<string, string>(); // table -> create-table body
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    const block = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)^\s*\)\s*;/gim;
    let m: RegExpExecArray | null;
    while ((m = block.exec(sql)) !== null) {
      const [, table, body] = m;
      if (/\buser_id\b/i.test(body) || /references\s+auth\.users/i.test(body)) found.set(table, body);
    }
  }
  return found;
}

describe("USER_DATA_TABLES covers the schema", () => {
  const inMigrations = userKeyedTablesInMigrations();

  it("finds the user tables in the migrations (the scan itself works)", () => {
    expect(inMigrations.size).toBeGreaterThan(5);
    expect([...inMigrations.keys()]).toContain("applications");
  });

  it("every user-keyed table in a migration is exported", () => {
    const exported = new Set(USER_DATA_TABLES.map((t) => t.table as string));
    const missing = [...inMigrations.keys()].filter((t) => !exported.has(t));
    expect(
      missing,
      `table(s) keyed to a user that the export never reads — add them to USER_DATA_TABLES in src/lib/account.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every exported table exists, and its user column is real", () => {
    for (const spec of USER_DATA_TABLES) {
      const body = inMigrations.get(spec.table as string);
      expect(body, `${spec.table} is exported but no migration creates it`).toBeTruthy();
      expect(body, `${spec.table}.${spec.column} is not a column of that table`).toMatch(
        new RegExp(`\\b${spec.column}\\b`, "i"),
      );
    }
  });

  it("every table carries user-facing copy for the deletion notice", () => {
    for (const spec of USER_DATA_TABLES) {
      expect(spec.label.length).toBeGreaterThan(8);
      expect(spec.label, "no em-dashes in user-facing copy (BRAND.md)").not.toContain("—");
    }
  });
});

type Fake = ExportClient & { reads: { table: string; column: string; value?: string; values?: string[] }[] };

function fakeClient(rows: Record<string, ExportRow[]> = {}, failOn?: string): Fake {
  const reads: Fake["reads"] = [];
  const result = (table: string) =>
    failOn === table
      ? Promise.resolve({ data: null, error: { message: "read failed" } })
      : Promise.resolve({ data: rows[table] ?? [], error: null });
  return {
    reads,
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              reads.push({ table, column, value });
              return result(table);
            },
            in(column: string, values: string[]) {
              reads.push({ table, column, values });
              return result(table);
            },
          };
        },
      };
    },
  };
}

describe("buildAccountExport", () => {
  it("reads every table by its own user column and stamps the account", async () => {
    const client = fakeClient();
    const out = await buildAccountExport(client, {
      userId: "user-1",
      email: "rober@example.com",
      now: new Date("2026-07-26T09:30:00.000Z"),
    });

    expect(out.format).toBe(ACCOUNT_EXPORT_FORMAT);
    expect(out.account).toEqual({ id: "user-1", email: "rober@example.com" });
    expect(out.exported_at).toBe("2026-07-26T09:30:00.000Z");

    for (const spec of USER_DATA_TABLES) {
      // referrals appears once per user column (issue #78), so match on both.
      const read = client.reads.find((r) => r.table === spec.table && r.column === spec.column);
      expect(read, `${spec.table}.${spec.column} was never read`).toBeTruthy();
      expect(read?.value).toBe("user-1");
      expect(out.data[spec.table]).toEqual([]);
    }
  });

  it("merges a table read once per user column under one key (referrals, issue #78)", async () => {
    const client = fakeClient({
      referrals: [{ referee_id: "user-1", referrer_id: "user-2" }],
    });
    const out = await buildAccountExport(client, { userId: "user-1" });
    // The fake returns the same rows for both directions; what matters is that the
    // second read APPENDS under the "referrals" key instead of overwriting it.
    expect(client.reads.filter((r) => r.table === "referrals")).toHaveLength(2);
    expect(out.data.referrals).toHaveLength(2);
  });

  it("carries the roles the user's own rows point at, deduped", async () => {
    const client = fakeClient({
      applications: [{ id: "a1", job_id: "job-1" }],
      saved_jobs: [{ id: "s1", job_id: "job-1" }],
      // Dismissing IS acting on a role, so the role it points at has to come along:
      // "the roles you dismissed" rendered as bare identifiers is complete but
      // unreadable, which defeats the point of handing someone their data.
      dismissed_jobs: [{ id: "d1", job_id: "job-3" }],
      artifacts: [{ id: "f1", job_id: "job-2" }, { id: "f2", job_id: null }],
      jobs: [
        { id: "job-1", title: "Product Manager" },
        { id: "job-2", title: "Senior Product Manager" },
        { id: "job-3", title: "Group Product Manager" },
      ],
    });
    const out = await buildAccountExport(client, { userId: "user-1" });

    const jobsRead = client.reads.find((r) => r.table === "jobs");
    expect(jobsRead?.values).toEqual(["job-1", "job-3", "job-2"]);
    expect(out.jobs).toHaveLength(3);
  });

  it("skips the catalogue read entirely when nothing references a role", async () => {
    const client = fakeClient();
    const out = await buildAccountExport(client, { userId: "user-1" });
    expect(client.reads.some((r) => r.table === "jobs")).toBe(false);
    expect(out.jobs).toEqual([]);
  });

  it("throws rather than hand over a partial file", async () => {
    const client = fakeClient({}, "applications");
    await expect(buildAccountExport(client, { userId: "user-1" })).rejects.toThrow(/applications/);
  });
});

describe("the downloaded file", () => {
  it("is dated so repeat exports do not overwrite each other", () => {
    expect(accountExportFilename(new Date("2026-07-26T23:59:00.000Z"))).toBe("northgoing-data-2026-07-26.json");
  });

  it("is readable JSON that round-trips", async () => {
    const payload = await buildAccountExport(fakeClient({ feedback: [{ id: "f", message: "hi" }] }), {
      userId: "user-1",
    });
    const text = accountExportText(payload);
    expect(text).toContain("\n  ");
    expect(JSON.parse(text).data.feedback).toEqual([{ id: "f", message: "hi" }]);
  });
});
