// Types for scripts/schema-drift-lib.mjs (issue #132), so the vitest pin in
// src/test/schema-drift-lib.test.ts can import the plain-Node module.

export type SnapshotRow = Record<string, unknown>;
export type SchemaSnapshot = Partial<Record<string, SnapshotRow[]>>;

/** The sections public.schema_snapshot() emits and the compare walks. */
export const SNAPSHOT_SECTIONS: readonly string[];

/** Strip `public.` qualification and collapse whitespace in a definition string; non-strings pass through. */
export function normalizeDef<T>(v: T): T;

/** Stable, sorted form of a snapshot for committing. */
export function canonicalSnapshot(snapshot: SchemaSnapshot): SchemaSnapshot;

/** One line per drift item; empty when the two snapshots describe the same schema. */
export function diffSchemaSnapshots(snapshot: SchemaSnapshot, live: SchemaSnapshot): string[];
