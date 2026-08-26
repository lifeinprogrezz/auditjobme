// Paged reads for the browser client.
//
// PostgREST caps an un-ranged select at 1000 rows. It does not error, does not warn,
// and returns no indication that anything was withheld — you simply get the first
// 1000 rows in no defined order.
//
// That shipped: `useRolesData` read `scores` un-ranged, so a user holding 8,763 scores
// saw 1,000. Roughly 89% of their scored roles rendered as unscored, the "N to go"
// counter never reached zero, the 20-second poll never stopped, and the Best-fit rail
// ranked an arbitrary 1,000-row sample — the product's central promise, computed from
// the wrong set.
//
// The server already knew (api/score-backlog.ts pages with an explicit comment). This
// puts the same knowledge on the client, in one place, so it is applied by habit rather
// than by remembering.

/** PostgREST's implicit ceiling. Matches the server-side constant deliberately. */
export const PAGE_SIZE = 1000;

/** The minimum a PostgREST query builder must expose to be paged. */
export type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

/**
 * Read every row a query matches, one page at a time.
 *
 * `build()` must return a FRESH query each call: a PostgREST builder is single-use, and
 * reusing one silently returns the first page again, which would loop forever.
 *
 * Stops when a page comes back short, which is the only reliable end signal — asking for
 * a count costs an extra round trip and can disagree with the rows under concurrent writes.
 * `maxPages` is a loop guard, not a limit anyone should rely on; hitting it means the
 * caller is reading something far larger than expected and should say so.
 *
 * `strict` changes what a failed page does: throw instead of returning the partial set.
 * Every caller that is a TanStack `queryFn` MUST pass it. A queryFn that resolves with a
 * short or empty array reports a SUCCESSFUL fetch, so the cache replaces the last good
 * rows with the failure's leftovers and every consumer re-derives off them; throwing
 * keeps the cached rows, marks the query `isError` and retries. Non-cached callers (the
 * nightly job) keep the lenient default, where a partial read beats no read at all.
 */
export async function fetchAllPages<T>(
  build: () => RangeQuery<T>,
  opts: { pageSize?: number; maxPages?: number; label?: string; strict?: boolean } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? 50;
  const out: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) {
      const what = `${opts.label ?? "query"} failed at page ${page}: ${error.message}`;
      if (opts.strict) throw new Error(`[pagedSelect] ${what}`);
      // Return what we have rather than throwing: a partial map beats a blank one, and
      // the caller's own error handling already covers the empty case.
      console.warn(`[pagedSelect] ${what}`);
      return out;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }

  console.warn(
    `[pagedSelect] ${opts.label ?? "query"} hit the ${maxPages}-page guard (${out.length} rows); the result is truncated.`,
  );
  return out;
}
