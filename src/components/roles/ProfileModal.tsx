// Profile surface (issue #43) + Settings (Rober 7-15): the avatar's destination.
// The PROFILE view shows identity + CV-on-file + workspace links + a Settings entry
// + sign out. Target roles / industries are NO LONGER shown here as read-only chips —
// they moved into an editable SETTINGS sub-view that reuses the CV modal's picker
// (ROLE_ARCHETYPES chips + live sector chips + a tail search) and writes back to the
// profile. Reuses the CV-unlock modal's shell + token classes (.cvmask/.cvmodal/…).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import {
  cvWordCount,
  formatUploadedDate,
  ROLE_ARCHETYPES,
  LABEL_CAP,
  TOP_SECTOR_CHIPS,
  visibleSectorChips,
  filterSectorSearch,
} from "@/lib/labels";
import type { FilterOption } from "./FilterChip";

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
  /** Live catalog sectors (from RolesMap) — the industry picker's options. */
  sectorOptions: FilterOption[];
  /** Persist edited target roles + industries to the profile. Resolves false on failure. */
  onSaveTargets: (roles: string[], sectors: string[]) => Promise<boolean>;
};

/** Toggle a value in/out of a capped list — ignores extra picks past the cap. */
function toggleCapped(list: string[], value: string, cap: number): string[] {
  if (list.includes(value)) return list.filter((v) => v !== value);
  if (list.length >= cap) return list;
  return [...list, value];
}

export default function ProfileModal({
  open,
  onClose,
  cvText,
  targetRoles,
  targetSectors,
  cvUpdatedAt,
  onReplaceCv,
  sectorOptions,
  onSaveTargets,
}: ProfileModalProps) {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<"profile" | "settings">("profile");
  const [editRoles, setEditRoles] = useState<string[]>(targetRoles);
  const [editSectors, setEditSectors] = useState<string[]>(targetSectors);
  const [sectorQuery, setSectorQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed edits only when the modal OPENS. Keying the effect on targetRoles/
  // targetSectors would re-fire on their identity (recreated as fresh [] when
  // profileMeta is null), kicking the user out of an in-progress Settings edit on any
  // parent re-render such as a background score poll (Rober 7-15 review).
  useEffect(() => {
    if (!open) return;
    setView("profile");
    setEditRoles(targetRoles);
    setEditSectors(targetSectors);
    setSectorQuery("");
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  // Industry choices: the real catalog sectors (top by frequency), a picked tail
  // sector always kept visible; the search covers the long tail (issue #44).
  const industryOptions = visibleSectorChips(sectorOptions, editSectors, TOP_SECTOR_CHIPS);
  const sectorSearchResults = filterSectorSearch(sectorOptions, industryOptions, sectorQuery);

  const handleSignOut = async () => {
    await signOut();
    onClose();
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await onSaveTargets(editRoles, editSectors);
    setSaving(false);
    // Stay in Settings on failure so the user's edits survive the retry.
    if (ok) setView("profile");
  };

  return (
    <div
      className="cvmask"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cvmodal glass liquid"
        role="dialog"
        aria-modal="true"
        aria-label={view === "settings" ? "Settings" : "Your profile"}
      >
        <button className="cvclose" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {view === "profile" ? (
          <>
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

            {/* Reach the routed product surfaces + Settings from the map shell. */}
            <div className="cvsec">
              <div className="cvlbl">Your workspace</div>
              <div className="pf-nav">
                <Link className="pf-navlink" to="/today" onClick={onClose}>
                  Today
                </Link>
                <Link className="pf-navlink" to="/tracker" onClick={onClose}>
                  Applications
                </Link>
                <button type="button" className="pf-navlink" onClick={() => setView("settings")}>
                  Settings
                </button>
              </div>
            </div>

            <button type="button" className="filterbtn pf-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <button className="dback" onClick={() => setView("profile")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Profile
            </button>
            <h2 className="cvh">Settings</h2>
            <p className="cvsub">Tune the roles and industries you're targeting.</p>

            <div className="cvsec">
              <div className="cvlbl">
                Target roles <span className="cvcap">pick up to {LABEL_CAP}</span>
              </div>
              <div className="cvchips">
                {ROLE_ARCHETYPES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={"cvchip" + (editRoles.includes(r) ? " on" : "")}
                    onClick={() => setEditRoles((cur) => toggleCapped(cur, r, LABEL_CAP))}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="cvsec">
              <div className="cvlbl">
                Target industries <span className="cvcap">pick up to {LABEL_CAP}</span>
              </div>
              <div className="cvchips">
                {industryOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={"cvchip" + (editSectors.includes(s) ? " on" : "")}
                    onClick={() => setEditSectors((cur) => toggleCapped(cur, s, LABEL_CAP))}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {sectorOptions.length > TOP_SECTOR_CHIPS && (
                <div className="cvmore">
                  <input
                    className="fdrop-search"
                    type="text"
                    placeholder="Search more industries…"
                    value={sectorQuery}
                    onChange={(e) => setSectorQuery(e.target.value)}
                  />
                  {sectorQuery.trim() && (
                    <div className="fdrop fdrop-list">
                      {sectorSearchResults.map((o) => (
                        <label key={o.value}>
                          <input
                            type="checkbox"
                            checked={editSectors.includes(o.value)}
                            onChange={() => setEditSectors((cur) => toggleCapped(cur, o.value, LABEL_CAP))}
                          />
                          <span className="fdrop-lab">{o.label}</span>
                          <span className="fdrop-n">{o.count}</span>
                        </label>
                      ))}
                      {sectorSearchResults.length === 0 && <div className="fdrop-empty">No matches</div>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button className="cvcta" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
