// Account data: the export payload and the one list of tables keyed to a user
// (issue #84, the launch gate). The product launches to European residents, so
// "download everything you hold about me" and "delete my account" are obligations.
//
// USER_DATA_TABLES is the single source of truth for BOTH surfaces: the export reads
// every entry, and the deletion copy lists every label, so neither can quietly fall
// behind the schema. The list was walked table by table against supabase/migrations/
// rather than assumed, and account-tables.test.ts fails if a migration adds a table
// keyed to auth.users that nobody added here. The database side of the same promise
// is pinned in supabase/tests/assert_rls.sql (every foreign key to auth.users
// cascades, and delete_own_account() really empties the account).
import type { Database } from "@/integrations/supabase/types";

export type UserTableName = keyof Database["public"]["Tables"];

export type UserDataTable = {
  /** Table in the public schema. */
  table: UserTableName;
  /** The column carrying the user identifier (profiles is keyed by id). */
  column: string;
  /** What it holds, in the user's words. This is also the deletion copy. */
  label: string;
};

/** Every table that carries a user identifier, in the order a person would read them. */
export const USER_DATA_TABLES: readonly UserDataTable[] = [
  { table: "profiles", column: "id", label: "your profile and the text of your CV" },
  { table: "applications", column: "user_id", label: "the roles you marked as applied" },
  { table: "status_events", column: "user_id", label: "the status history of every application" },
  { table: "saved_jobs", column: "user_id", label: "the roles you saved" },
  { table: "dismissed_jobs", column: "user_id", label: "the roles you dismissed" },
  { table: "scores", column: "user_id", label: "your match score for every role" },
  { table: "daily_matches", column: "user_id", label: "your nightly match lists" },
  {
    table: "artifacts",
    column: "user_id",
    label: "every tailored CV, cover letter and set of answers we generated for you",
  },
  { table: "audits", column: "user_id", label: "the company audits you generated" },
  { table: "company_requests", column: "user_id", label: "the companies you asked us to add" },
  { table: "feedback", column: "user_id", label: "the feedback you sent us" },
  { table: "usage_events", column: "user_id", label: "your AI usage records" },
  {
    table: "device_fingerprints",
    column: "user_id",
    label: "the device signal we use to keep free usage fair",
  },
  { table: "purchases", column: "user_id", label: "any purchase records" },
] as const;

/** Tables whose rows point at a role in the shared catalogue, so the export can carry it. */
const JOB_REFERENCE_TABLES: readonly UserTableName[] = [
  "applications",
  "saved_jobs",
  "dismissed_jobs",
  "artifacts",
];

export const ACCOUNT_EXPORT_FORMAT = "auditjob.me account export";
export const ACCOUNT_EXPORT_VERSION = 1;

export const ACCOUNT_EXPORT_README =
  "Everything auditjob.me holds about your account, straight from the database. " +
  "Each key under `data` is one table, and each row is exactly as we store it. " +
  "`jobs` carries the roles your applications, saved roles, dismissals and generated " +
  "documents point at, so the file reads on its own. Roles you have not acted on come from the " +
  "public job catalogue, which is the same for everyone and is not personal data.";

export type ExportRow = Record<string, unknown>;

type QueryResult = { data: ExportRow[] | null; error: { message: string } | null };

/**
 * The slice of the Supabase client this module needs. Structural on purpose: the
 * builder is generic over the generated Database types, and pinning that here would
 * make the export untestable without a live project.
 */
export type ExportClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<QueryResult>;
      in(column: string, values: string[]): PromiseLike<QueryResult>;
    };
  };
};

export type AccountExport = {
  format: string;
  version: number;
  readme: string;
  exported_at: string;
  account: { id: string; email: string | null };
  data: Record<string, ExportRow[]>;
  jobs: ExportRow[];
};

/** Collect the distinct, non-empty job ids the user's own rows point at. */
function referencedJobIds(data: Record<string, ExportRow[]>): string[] {
  const ids = new Set<string>();
  for (const table of JOB_REFERENCE_TABLES) {
    for (const row of data[table] ?? []) {
      const id = row.job_id;
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Read every row the product holds for this account and assemble the export.
 *
 * Throws on the first read that fails: a partial file handed over as "everything we
 * hold" would be worse than no file at all.
 */
export async function buildAccountExport(
  client: ExportClient,
  opts: { userId: string; email?: string | null; now?: Date },
): Promise<AccountExport> {
  const { userId, email = null, now = new Date() } = opts;
  const data: Record<string, ExportRow[]> = {};

  for (const spec of USER_DATA_TABLES) {
    const { data: rows, error } = await client.from(spec.table).select("*").eq(spec.column, userId);
    if (error) throw new Error(`Could not read ${spec.table}: ${error.message}`);
    data[spec.table] = rows ?? [];
  }

  const jobIds = referencedJobIds(data);
  let jobs: ExportRow[] = [];
  if (jobIds.length > 0) {
    const { data: rows, error } = await client.from("jobs").select("*").in("id", jobIds);
    if (error) throw new Error(`Could not read jobs: ${error.message}`);
    jobs = rows ?? [];
  }

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    readme: ACCOUNT_EXPORT_README,
    exported_at: now.toISOString(),
    account: { id: userId, email },
    data,
    jobs,
  };
}

/** File name for the download, dated so repeat exports never overwrite each other. */
export function accountExportFilename(now: Date = new Date()): string {
  return `auditjob-me-data-${now.toISOString().slice(0, 10)}.json`;
}

/** The file body: pretty-printed so it opens readably in any text editor. */
export function accountExportText(payload: AccountExport): string {
  return JSON.stringify(payload, null, 2);
}
