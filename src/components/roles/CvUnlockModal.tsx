// CV-unlock modal (Phase A, overnight-job-hunter spec 2026-07-07): the /roles
// front door. Drop a PDF (parsed client-side, no login), pick target roles +
// industries, then sign in — the reveal lights the map up in-session. Styled with
// the roles.css glass tokens (.glass/.liquid, --glass-2/--rim/--sh), NOT the old
// dark Onboarding palette. Scoring stays auth-gated: anon users only get the
// client-side parse + a localStorage stash handed off to the profile at sign-in.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ROLE_PICKER_OPTIONS,
  ROLE_CAP,
  SECTOR_CAP,
  TOP_SECTOR_CHIPS,
  visibleSectorChips,
  filterSectorSearch,
  cvWordCount,
  hashCv,
  writeCvStash,
} from "@/lib/labels";
import { track } from "@/lib/analytics";
import type { FilterOption } from "./FilterChip";
import { revealProgressLabel, REVEAL_MIN_SCORES } from "@/lib/scoreReveal";


type Stage = "idle" | "reading" | "parsed";

export type CvUnlockModalProps = {
  open: boolean;
  onClose: () => void;
  signedIn: boolean;
  /** Industries a user may PICK (from RolesMap): the live catalog's sectors, gated
   *  on liquidity so a chosen one can actually return roles (issue #70). */
  sectorOptions: FilterOption[];
  /** Writes the CV + labels to the profile and reveals + scores in-session (signed-in path). */
  onSubmit: (text: string, labels: { roles: string[]; sectors: string[] }) => Promise<boolean>;
  /** Roles scored so far while this screen is held open, or null when nothing is
   *  waiting. The screen stays up until the first batch lands (Rober, 2026-08-28),
   *  so it has to say what that wait is for. */
  revealScored?: number | null;
};

function toggleCapped(list: string[], value: string, cap: number): string[] {
  if (list.includes(value)) return list.filter((v) => v !== value);
  if (list.length >= cap) return list; // cap reached — ignore extra picks
  return [...list, value];
}

export default function CvUnlockModal({
  open,
  onClose,
  signedIn,
  sectorOptions,
  onSubmit,
  revealScored,
}: CvUnlockModalProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [cvText, setCvText] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [sectorQuery, setSectorQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset to a clean idle state whenever the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    setStage("idle");
    setCvText("");
    setError("");
    setDragging(false);
    setRoles([]);
    setSectors([]);
    setSectorQuery("");
    setSubmitting(false);
  }, [open]);

  // Escape closes (unless mid-submit).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  // Industry choices: the real catalog sectors (top by frequency) so the scoring
  // filter matches exactly; fall back to a curated list when the catalog is bare.
  // A picked tail sector always stays visible even once it falls out of the top N.
  const industryOptions = visibleSectorChips(sectorOptions, sectors, TOP_SECTOR_CHIPS);
  const sectorSearchResults = filterSectorSearch(sectorOptions, industryOptions, sectorQuery);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("That's not a PDF. Upload your CV as a PDF file.");
      return;
    }
    setError("");
    setStage("reading");
    try {
      const { extractPdfText } = await import("@/lib/pdfText"); // lazy: keep pdfjs out of the initial bundle
      const text = await extractPdfText(file);
      setCvText(text);
      setStage("parsed");
      // Word count only — never the CV text itself (issue #89).
      track("cv_uploaded", { word_count: cvWordCount(text) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that PDF.");
      setStage("idle");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer?.files?.[0]);
  };

  const handleSubmit = async () => {
    if (!cvText.trim() || submitting) return;
    track("cv_submitted");
    setSubmitting(true);
    setError("");
    const labels = { roles, sectors };
    if (signedIn) {
      // Already signed in — write straight to the profile and reveal in-session.
      const ok = await onSubmit(cvText, labels);
      if (ok) {
        onClose();
      } else {
        setError("Couldn't save your CV. Please try again.");
        setSubmitting(false);
      }
      return;
    }
    // Anon: stash the CV + labels so they survive the OAuth full-page redirect,
    // then hand off to the profile in a post-sign-in effect (useRolesData). If the
    // stash write fails (Safari private browsing / quota) the CV would vanish
    // across the redirect — abort sign-in and tell the user instead.
    const stashed = writeCvStash({
      cv_text: cvText,
      cv_hash: hashCv(cvText),
      target_roles: roles,
      target_sectors: sectors,
    });
    if (!stashed) {
      setError("Couldn't save your CV for sign-in — try again, or use a normal browser window.");
      setSubmitting(false);
      return;
    }
    const { error: authErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authErr) {
      setError(authErr.message || "Sign-in failed. Please try again.");
      setSubmitting(false);
    }
    // On success the browser redirects away — no further work here.
  };

  // Returning-user shortcut (Rober 7-13): straight to Google OAuth, no CV drop
  // and no stash — the post-sign-in gate (shouldPromptCv) re-opens this modal if
  // the profile turns out to have no CV, so the CV-mandatory invariant holds.
  const handleSignIn = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const { error: authErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authErr) {
      setError(authErr.message || "Sign-in failed. Please try again.");
      setSubmitting(false);
    }
    // On success the browser redirects away — no further work here.
  };

  // Always offered to a signed-out visitor (issue #158 / A1): a first-time
  // visitor who already has a profile on another device — or just recognizes
  // the flow — needs the same door as a returning one. Used to gate on
  // hasSeenSession() (device memory, still used elsewhere in deviceSession.ts)
  // and hid the line from every brand-new visitor, which is most of them.
  const offerSignIn = !signedIn;

  const wordCount = cvWordCount(cvText);

  return (
    <div
      className="cvmask"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="cvmodal glass liquid" role="dialog" aria-modal="true" aria-label="Add your CV">
        <button className="cvclose" aria-label="Close" onClick={onClose} disabled={submitting}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 className="cvh">See which roles fit you</h2>
        <p className="cvsub">Drop your CV and see your fit for every live role.</p>

        {stage !== "parsed" ? (
          <label
            className={"cvdrop" + (dragging ? " over" : "") + (stage === "reading" ? " busy" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              if (stage !== "reading") setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              disabled={stage === "reading"}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // allow re-selecting the same file
                readFile(f);
              }}
              style={{ display: "none" }}
            />
            <svg className="cvdrop-i" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
            <div className="cvdrop-t">
              {stage === "reading" ? "Reading your CV…" : "Drop your CV here, or browse"}
            </div>
            <div className="cvdrop-s">PDF only. Stays in your browser.</div>
          </label>
        ) : null}
        {stage !== "parsed" && offerSignIn ? (
          <p className="cvreturn">
            Already have a profile?{" "}
            <button type="button" className="cvreturn-a" onClick={handleSignIn} disabled={submitting}>
              Sign in
            </button>
          </p>
        ) : null}
        {stage === "parsed" ? (
          <>
            <div className="cvread">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              We read your CV
              <span className="cvread-n">{wordCount.toLocaleString()} words</span>
              <button className="cvread-x" onClick={() => setStage("idle")}>
                Replace
              </button>
            </div>

            <div className="cvsec">
              <div className="cvlbl">
                Target roles <span className="cvcap">pick up to {ROLE_CAP}</span>
              </div>
              <div className="cvchips">
                {ROLE_PICKER_OPTIONS.map((r) => {
                  const selected = roles.includes(r.value);
                  const capped = !selected && roles.length >= ROLE_CAP;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      disabled={capped}
                      className={"cvchip" + (selected ? " on" : "")}
                      onClick={() => setRoles((cur) => toggleCapped(cur, r.value, ROLE_CAP))}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="cvsec">
              <div className="cvlbl">
                Target industries <span className="cvcap">pick up to {SECTOR_CAP}</span>
              </div>
              <div className="cvchips">
                {industryOptions.map((s) => {
                  const selected = sectors.includes(s);
                  const capped = !selected && sectors.length >= SECTOR_CAP;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={capped}
                      className={"cvchip" + (selected ? " on" : "")}
                      onClick={() => setSectors((cur) => toggleCapped(cur, s, SECTOR_CAP))}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {/* The industries picker is gated on liquidity (>=3 employers, >=20
                  live roles) unlike the map's sector filter, which shows every
                  sector present with no gate — say so, so the divergence reads
                  as deliberate rather than a shorter list (issue #158 / A4). */}
              <p className="cvhint">Showing the {TOP_SECTOR_CHIPS} industries with the most open roles.</p>
              {/* Tail search: same fdrop-search/fdrop-list/checkbox pattern as the
                  headbar's searchable FilterChip dropdown (FilterChip.tsx), reused
                  in-flow here rather than as a flyout — only shows once the live
                  catalog outgrows the visible chip row. */}
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
                      {sectorSearchResults.map((o) => {
                        const selected = sectors.includes(o.value);
                        const capped = !selected && sectors.length >= SECTOR_CAP;
                        return (
                          <label key={o.value}>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={capped}
                              onChange={() => setSectors((cur) => toggleCapped(cur, o.value, SECTOR_CAP))}
                            />
                            <span className="fdrop-lab">{o.label}</span>
                            <span className="fdrop-n">{o.count}</span>
                          </label>
                        );
                      })}
                      {sectorSearchResults.length === 0 && (
                        <div className="fdrop-empty">No matches</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}

        {error && <p className="cverr">{error}</p>}

        {stage === "parsed" && (
          <>
            <button className="cvcta" onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? signedIn
                  ? "Scoring your matches…"
                  : "Redirecting to Google…"
                : signedIn
                  ? "Reveal my matches"
                  : "Continue with Google"}
            </button>
            {/* The wait is real and about a minute, so it gets a count rather than a
                spinner. Without it the button just said "Scoring…" for 60 seconds
                and looked stuck (Rober, 2026-08-28). */}
            {submitting && signedIn && revealScored != null && (
              <div className="cvwait" role="status" aria-live="polite">
                {/* Foreground text, not the muted hint grey: this is the one thing on
                    screen for a minute and it read as an afterthought (Rober,
                    2026-08-28). The bar is the same thin track the panel's scoring
                    whisper uses, so the two waits look like one system. */}
                <div className="sprog-track" aria-hidden="true">
                  <div
                    className="sprog-fill"
                    style={{ width: `${Math.round((100 * Math.min(revealScored, REVEAL_MIN_SCORES)) / REVEAL_MIN_SCORES)}%` }}
                  />
                </div>
                <p className="cvwait-line">
                  <b>{revealProgressLabel(revealScored)}</b> roles scored. Your map opens as soon as the first are ready.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
