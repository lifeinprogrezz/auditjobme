// Company-audit deep link (issue #82). Apply Step 3 hands off to the standalone
// audit generator at /audit, prefilling the job posting so the user never
// repastes it. Pure on purpose: the URL shape is pinned by a unit test, and the
// Apply page only ever navigates to it, never generates anything itself.
export function auditHref(jobUrl: string): string {
  return `/audit?job=${encodeURIComponent(jobUrl)}`;
}
