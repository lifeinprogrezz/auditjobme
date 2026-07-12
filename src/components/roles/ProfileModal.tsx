// Profile surface (issue #43): the avatar's real destination, replacing the old
// /underconstruction dead-end. Shows what auditjob.me already has on file for a
// returning signed-in user — CV word count + upload date, picked target labels —
// and a Replace CV action that routes straight into the SAME CvUnlockModal parsed
// flow (RolesMap owns the one shared instance; onReplaceCv just opens it). Sign
// out lives here too. Reuses the CV-unlock modal's shell + token classes verbatim
// (.cvmask/.cvmodal/.cvread/.cvchip/…) — no new visual language, ink-glass only.
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { cvWordCount, formatUploadedDate } from "@/lib/labels";

export type ProfileModalProps = {
  open: boolean;
  onClose: () => void;
  /** Stored CV text (null/empty when the user hasn't dropped one yet). */
  cvText: string | null;
  targetRoles: string[];
  targetSectors: string[];
  /** profiles.updated_at as of the last CV write. */
  cvUpdatedAt: string | null;
  /** Opens the CV-unlock modal's parsed flow — Replace CV reuses it, doesn't rebuild it. */
  onReplaceCv: () => void;
};

export default function ProfileModal({
  open,
  onClose,
  cvText,
  targetRoles,
  targetSectors,
  cvUpdatedAt,
  onReplaceCv,
}: ProfileModalProps) {
  const { user, signOut } = useAuth();

  // Escape closes (mirrors CvUnlockModal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasCv = Boolean(cvText?.trim());
  const wordCount = cvWordCount(cvText);
  const uploaded = formatUploadedDate(cvUpdatedAt);

  const handleSignOut = async () => {
    await signOut();
    onClose();
  };

  return (
    <div
      className="cvmask"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cvmodal glass liquid" role="dialog" aria-modal="true" aria-label="Your profile">
        <button className="cvclose" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 className="cvh">Your profile</h2>
        <p className="cvsub">
          {user?.email ? `Signed in as ${user.email}` : "Manage your stored CV and targets."}
        </p>

        <div className="cvsec">
          {hasCv ? (
            <>
              <div className="cvread">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                CV on file
                <span className="cvread-n">{wordCount.toLocaleString()} words</span>
                <button className="cvread-x" onClick={onReplaceCv}>
                  Replace
                </button>
              </div>
              {uploaded && <p className="cvdrop-s">Uploaded {uploaded}</p>}
            </>
          ) : (
            <>
              <div className="panel-note">
                <b>No CV on file yet</b>
                Drop your CV to see your match score for every live role.
              </div>
              <button type="button" className="cvcta" onClick={onReplaceCv}>
                Add your CV
              </button>
            </>
          )}
        </div>

        <div className="cvsec">
          <div className="cvlbl">Target roles</div>
          <div className="cvchips">
            {targetRoles.length > 0 ? (
              targetRoles.map((r) => (
                <span key={r} className="cvchip on">
                  {r}
                </span>
              ))
            ) : (
              <span className="cvcap">None picked yet</span>
            )}
          </div>
        </div>

        {/* Reach the routed product surfaces from the map shell (issue #42). */}
        <div className="cvsec">
          <div className="cvlbl">Your workspace</div>
          <div className="pf-nav">
            <Link className="pf-navlink" to="/today" onClick={onClose}>
              Today
            </Link>
            <Link className="pf-navlink" to="/tracker" onClick={onClose}>
              Applications
            </Link>
          </div>
        </div>

        <div className="cvsec">
          <div className="cvlbl">Target industries</div>
          <div className="cvchips">
            {targetSectors.length > 0 ? (
              targetSectors.map((s) => (
                <span key={s} className="cvchip on">
                  {s}
                </span>
              ))
            ) : (
              <span className="cvcap">None picked yet</span>
            )}
          </div>
        </div>

        <button type="button" className="filterbtn pf-signout" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
