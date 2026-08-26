#!/usr/bin/env node
// Schema drift check (issue #132): does a live database match the checked-in
// snapshot of production's public schema?
//
//   node scripts/schema-drift-check.mjs            compare live vs supabase/schema-snapshot.json
//   node scripts/schema-drift-check.mjs --write    rewrite the snapshot from the live database
//
// The live side is read through public.schema_snapshot() (migration
// 20260826150000), reached one of two ways, tried in this order:
//   1. DATABASE_URL            -> `psql` on PATH runs `select public.schema_snapshot()`
//                                 (the local Supabase stack in CI: DB_URL from `supabase status`)
//   2. SUPABASE_URL +          -> PostgREST RPC with the service-role key
//      SUPABASE_SERVICE_ROLE_KEY  (production; the function is service_role-only)
//
// Exit 0 when the schemas match, 1 on drift (the diff is printed), 2 on a
// configuration or transport error. The compare itself is pure and pinned by
// src/test/schema-drift-lib.test.ts.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSnapshot, diffSchemaSnapshots } from "./schema-drift-lib.mjs";

const SNAPSHOT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/schema-snapshot.json");

function viaPsql(databaseUrl) {
  const out = execFileSync(
    "psql",
    [databaseUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", "select public.schema_snapshot()::text"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out.trim());
}

async function viaRest(url, key) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/schema_snapshot`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`rpc/schema_snapshot -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function readLive() {
  const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (DATABASE_URL) return { source: "psql", snapshot: viaPsql(DATABASE_URL) };
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    return { source: SUPABASE_URL, snapshot: await viaRest(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) };
  }
  throw new Error("set DATABASE_URL (needs psql on PATH) or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
}

async function main() {
  const write = process.argv.includes("--write");
  let live;
  try {
    live = await readLive();
  } catch (err) {
    console.error(`schema-drift: cannot read the live schema: ${err.message}`);
    process.exit(2);
  }

  if (write) {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(canonicalSnapshot(live.snapshot), null, 1)}\n`);
    console.log(`schema-drift: wrote ${SNAPSHOT_PATH} from ${live.source}`);
    return;
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const drift = diffSchemaSnapshots(snapshot, live.snapshot);
  if (drift.length === 0) {
    console.log(`schema-drift: OK — live schema (${live.source}) matches supabase/schema-snapshot.json`);
    return;
  }
  console.error(`schema-drift: ${drift.length} difference(s) between supabase/schema-snapshot.json and the live schema (${live.source}):`);
  for (const line of drift) console.error(`  ${line}`);
  console.error(
    "schema-drift: a '+' line is an object only the live database has — write a migration for it; " +
      "a '-' line is a migration never applied there. Once the migration set is the source of truth again, " +
      "refresh the snapshot with --write and commit it in the same change.",
  );
  process.exit(1);
}

main();
