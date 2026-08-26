// Pins the pure compare behind scripts/schema-drift-check.mjs (issue #132).
//
// The check exists because production once held objects no migration file
// described, so the CI RLS gate validated a narrower schema than the live one.
// The compare has to report every shape of drift, name the object, and stay
// silent when only ordering differs — a false positive here trains people to
// ignore the gate.
import { describe, expect, it } from "vitest";
import { canonicalSnapshot, diffSchemaSnapshots, SNAPSHOT_SECTIONS } from "../../scripts/schema-drift-lib.mjs";

const base = () => ({
  tables: [{ name: "jobs", kind: "r", rls: true }],
  columns: [
    { table: "jobs", name: "id", type: "uuid", udt: "uuid", nullable: false, default: "gen_random_uuid()", generated: null },
    { table: "jobs", name: "url", type: "text", udt: "text", nullable: false, default: null, generated: null },
  ],
  constraints: [{ table: "jobs", name: "jobs_pkey", def: "PRIMARY KEY (id)" }],
  indexes: [{ table: "jobs", name: "jobs_pkey", def: "CREATE UNIQUE INDEX jobs_pkey ON public.jobs USING btree (id)" }],
  policies: [
    { table: "jobs", name: "Anyone can read live jobs", permissive: "PERMISSIVE", roles: "{anon}", cmd: "SELECT", qual: "(is_live = true)", with_check: null },
  ],
  functions: [
    { name: "link_jobs_to_companies", args: "", returns: "integer", language: "sql", security_definer: true, config: ["search_path=public"], body_md5: "abc" },
  ],
  triggers: [{ table: "applications", name: "applications_log_status_insert", def: "CREATE TRIGGER ..." }],
  views: [{ name: "public_profiles", def: "SELECT id FROM profiles" }],
});

describe("diffSchemaSnapshots", () => {
  it("reports nothing when the live schema matches the snapshot", () => {
    expect(diffSchemaSnapshots(base(), base())).toEqual([]);
  });

  it("ignores row order inside every section", () => {
    const live = base();
    live.columns.reverse();
    expect(diffSchemaSnapshots(base(), live)).toEqual([]);
  });

  it("names an object present in the snapshot but missing from the live schema", () => {
    const live = base();
    live.columns = live.columns.filter((c) => c.name !== "url");
    const out = diffSchemaSnapshots(base(), live);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^- columns jobs\.url: in snapshot, not in live/);
  });

  it("names an object present in the live schema but absent from the snapshot", () => {
    const live = base();
    live.tables.push({ name: "headcount_bucket_backup_20260726", kind: "r", rls: true });
    const out = diffSchemaSnapshots(base(), live);
    expect(out).toEqual(["+ tables headcount_bucket_backup_20260726: in live, not in snapshot"]);
  });

  it("reports a changed field on a matched object, with both values", () => {
    const live = base();
    live.policies[0].qual = "true";
    const out = diffSchemaSnapshots(base(), live);
    expect(out).toEqual([
      '~ policies jobs.Anyone can read live jobs: qual snapshot="(is_live = true)" live="true"',
    ]);
  });

  it("treats a function's identity as name plus argument list, so overloads are distinct", () => {
    const live = base();
    live.functions.push({ ...live.functions[0], args: "p_limit integer" });
    const out = diffSchemaSnapshots(base(), live);
    expect(out).toEqual(["+ functions link_jobs_to_companies(p_limit integer): in live, not in snapshot"]);
  });

  it("flags a function whose body hash moved", () => {
    const live = base();
    live.functions[0].body_md5 = "def";
    expect(diffSchemaSnapshots(base(), live)).toEqual([
      '~ functions link_jobs_to_companies(): body_md5 snapshot="abc" live="def"',
    ]);
  });

  it("compares array-valued fields by value, not identity", () => {
    const live = base();
    live.functions[0].config = ["search_path=public"];
    expect(diffSchemaSnapshots(base(), live)).toEqual([]);
    live.functions[0].config = ["search_path=\"\""];
    expect(diffSchemaSnapshots(base(), live)).toHaveLength(1);
  });

  it("treats a missing section as empty rather than crashing", () => {
    const live = base();
    delete (live as Partial<ReturnType<typeof base>>).views;
    expect(diffSchemaSnapshots(base(), live)).toEqual(["- views public_profiles: in snapshot, not in live"]);
  });

  it("canonical form is byte-stable across row and key order, and never drifts from itself", () => {
    const a = base();
    const b: Record<string, Record<string, unknown>[]> = base();
    b.columns.reverse();
    b.policies = b.policies.map((p) => Object.fromEntries(Object.entries(p).reverse()));
    const shuffled = Object.fromEntries(Object.entries(b).reverse());
    expect(JSON.stringify(canonicalSnapshot(a))).toEqual(JSON.stringify(canonicalSnapshot(shuffled)));
    expect(Object.keys(canonicalSnapshot(a))).toEqual([...SNAPSHOT_SECTIONS]);
    expect(diffSchemaSnapshots(canonicalSnapshot(a), a)).toEqual([]);
  });

  it("ignores schema qualification and whitespace, which vary with the session search_path", () => {
    const live = base();
    live.constraints[0].def = "FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE";
    const snap = base();
    snap.constraints[0].def = "FOREIGN KEY (job_id)  REFERENCES jobs(id) ON DELETE CASCADE ";
    live.triggers[0].def = "CREATE TRIGGER t AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.log_application_status_event()";
    snap.triggers[0].def = "CREATE TRIGGER t AFTER INSERT ON applications FOR EACH ROW EXECUTE FUNCTION log_application_status_event()";
    live.views[0].def = " SELECT id,\n    username\n   FROM public.profiles p";
    snap.views[0].def = " SELECT id,\n    username\n   FROM profiles p";
    live.policies[0].qual = "(EXISTS ( SELECT 1 FROM public.applications a WHERE (a.job_id = jobs.id)))";
    snap.policies[0].qual = "(EXISTS ( SELECT 1\n   FROM applications a\n  WHERE (a.job_id = jobs.id)))";
    expect(diffSchemaSnapshots(snap, live)).toEqual([]);
  });

  it("still reports a real change inside a definition after normalisation", () => {
    const live = base();
    live.constraints[0].def = "FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL";
    const snap = base();
    snap.constraints[0].def = "FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE";
    expect(diffSchemaSnapshots(snap, live)).toEqual([
      '~ constraints jobs.jobs_pkey: def snapshot="FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE" live="FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL"',
    ]);
  });

  it("covers every section the snapshot function emits", () => {
    expect([...SNAPSHOT_SECTIONS].sort()).toEqual(
      ["columns", "constraints", "functions", "indexes", "policies", "tables", "triggers", "views"],
    );
  });
});
