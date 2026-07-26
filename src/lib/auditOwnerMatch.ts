// Resolves the /a/:username/:slug public-audit route (issue #90 follow-up).
// A slug is unique per OWNER, not globally, so more than one published audit
// can share a slug across different users. The bug: when exactly one
// candidate happened to match the slug, the page rendered it without ever
// checking that its owner's profile actually matches the :username segment --
// a wrong username in the path still rendered the right person's audit. The
// link is username+slug together, not slug alone, so this always resolves
// through the profile match, even with a single candidate.
export interface AuditMatchRow {
  user_id: string;
}

export interface OwnerProfile {
  // Nullable to match the public_profiles view's generated type (views don't
  // carry NOT NULL through Supabase codegen, even though id is always set in
  // practice) -- a null id simply never equals a real user_id, so it's safe.
  id: string | null;
  username?: string | null;
  display_name?: string | null;
}

export function slugifyOwner(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Finds the published audit whose owner's profile slug equals the requested
 *  :username, or null if no owner matches -- never falls back to "there was
 *  only one candidate, so it must be the right one". */
export function resolveAuditMatch<T extends AuditMatchRow>(
  matchingAudits: T[],
  profiles: OwnerProfile[],
  requestedUsername: string,
): T | null {
  const requestedOwner = slugifyOwner(requestedUsername);
  const matchedProfile = profiles.find(
    (profile) => slugifyOwner(profile.username || profile.display_name || "") === requestedOwner,
  );
  if (!matchedProfile) return null;
  return matchingAudits.find((audit) => audit.user_id === matchedProfile.id) || null;
}
