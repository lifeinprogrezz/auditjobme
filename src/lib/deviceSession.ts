// Returning-user device memory (Rober 7-13). Two small pieces:
//
// 1. A localStorage flag stamped the first time this device ever holds a
//    Supabase session. Sign-out clears supabase's own storage, never this key,
//    so "had a session before but is signed out now" stays detectable — that is
//    the ONLY audience for the CV modal's quiet "Sign in" line. A brand-new
//    visitor sees a pure single-purpose CV modal with zero auth noise.
//
// 2. shouldPromptCv — the pure post-OAuth gate that keeps a CV mandatory as an
//    invariant rather than a door policy: whichever way someone signs in, a
//    session with no CV on the profile (and no pre-redirect stash about to fill
//    it) gets the CV modal opened in front of them.
// Keeps its pre-rebrand prefix ON PURPOSE (#106): the key names a slot in browsers
// we do not control, so a rename makes every returning device read as brand new.
export const SESSION_SEEN_KEY = "auditjobme.hadSession";

/** Stamp "this device has held a session". Storage-safe: private-mode / quota
 *  failures are ignored — the flag is a nicety, never load-bearing. */
export function markSessionSeen(): void {
  try {
    localStorage.setItem(SESSION_SEEN_KEY, "1");
  } catch {
    /* ignore — localStorage unavailable */
  }
}

/** True when this device has ever held a session (survives sign-out). */
export function hasSeenSession(): boolean {
  try {
    return localStorage.getItem(SESSION_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Post-sign-in CV gate: prompt exactly when a signed-in user's loaded profile
 *  has no CV and no stashed pre-redirect drop is about to provide one. */
export function shouldPromptCv(s: {
  signedIn: boolean;
  profileChecked: boolean;
  hasCv: boolean;
  stashPending: boolean;
}): boolean {
  return s.signedIn && s.profileChecked && !s.hasCv && !s.stashPending;
}
