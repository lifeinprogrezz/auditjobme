// SettingsPanel — the pure, props-driven body of the /settings PAGE (Rober 7-25:
// settings graduated from the map's ProfileModal popup to a real routed surface,
// "a proper good definition on the app"). Same data contract the modal had, so the
// pinned states carry over: CV-on-file vs empty, Replace wiring, editable target
// roles / industries, Save persistence. Paper idiom throughout (§3.2 sections).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  cvWordCount,
  formatUploadedDate,
  ROLE_ARCHETYPES,
  LABEL_CAP,
  TOP_SECTOR_CHIPS,
  visibleSectorChips,
  filterSectorSearch,
} from "@/lib/labels";
import { USER_DATA_TABLES } from "@/lib/account";
import type { FilterOption } from "@/components/roles/FilterChip";
import type { RoleJob } from "@/lib/roles";

export type SettingsPanelProps = {
  /** Stored CV text (null/empty when the user hasn't dropped one yet). */
  cvText: string | null;
  targetRoles: string[];
  targetSectors: string[];
  /** profiles.updated_at as of the last CV write. */
  cvUpdatedAt: string | null;
  /** Routes into the CV-unlock flow on the map — Replace reuses it, never rebuilds it. */
  onReplaceCv: () => void;
  /** Live catalog sectors — the industry picker's options. */
  sectorOptions: FilterOption[];
  /** Persist edited target roles + industries. Resolves false on failure. */
  onSaveTargets: (roles: string[], sectors: string[]) => Promise<boolean>;
  /** Signed-in identity caption (e.g. the account email). */
  email?: string | null;
  /** Roles the user said "not interested" to (issue #73 slice 4). Optional: the
   *  section is simply absent when there are none. */
  dismissedJobs?: RoleJob[];
  /** Put one back in the queue. */
  onRestoreDismissed?: (job: RoleJob) => void;
  /** Build and download the account export. Resolves false on failure (issue #84). */
  onExportData: () => Promise<boolean>;
  /** Delete the account for real. Resolves false on failure; on success the app signs out. */
  onDeleteAccount: () => Promise<boolean>;
};

/** The word someone has to type before the delete button does anything. */
export const DELETE_CONFIRM_WORD = "delete";

/** Toggle a value in/out of a capped list — ignores extra picks past the cap. */
function toggleCapped(list: string[], value: string, cap: number): string[] {
  if (list.includes(value)) return list.filter((v) => v !== value);
  if (list.length >= cap) return list;
  return [...list, value];
}

// One chip idiom for both pickers: control type, hairline border, and a filled
// ink "on" state (the literal class name "on" is part of the pinned contract).
const CHIP_OFF =
  "rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted-foreground transition-colors hover:text-foreground";
const CHIP_ON = "on rounded-full border border-foreground bg-foreground px-3 py-1.5 text-control font-medium text-background";

export default function SettingsPanel({
  cvText,
  targetRoles,
  targetSectors,
  cvUpdatedAt,
  onReplaceCv,
  sectorOptions,
  onSaveTargets,
  email,
  dismissedJobs = [],
  onRestoreDismissed,
  onExportData,
  onDeleteAccount,
}: SettingsPanelProps) {
  // Edits stay null until the first touch, then own the render — no effect-seeding
  // race against the async profile load (the ProfileModal open-seeding lesson,
  // Rober 7-15 review).
  const [editRoles, setEditRoles] = useState<string[] | null>(null);
  const [editSectors, setEditSectors] = useState<string[] | null>(null);
  const [sectorQuery, setSectorQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Account section (issue #84): export state, and a two-step delete.
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const roles = editRoles ?? targetRoles;
  const sectors = editSectors ?? targetSectors;

  const hasCv = Boolean(cvText?.trim());
  const wordCount = cvWordCount(cvText);
  const uploaded = formatUploadedDate(cvUpdatedAt);

  const industryOptions = visibleSectorChips(sectorOptions, sectors, TOP_SECTOR_CHIPS);
  const sectorSearchResults = filterSectorSearch(sectorOptions, industryOptions, sectorQuery);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSavedFlash(false);
    const ok = await onSaveTargets(roles, sectors);
    setSaving(false);
    // Edits survive a failed save for the retry; a success re-bases on the profile.
    if (ok) {
      setEditRoles(null);
      setEditSectors(null);
      setSavedFlash(true);
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    const ok = await onExportData();
    setExporting(false);
    if (!ok) setExportFailed(true);
  };

  const confirmed = confirmWord.trim().toLowerCase() === DELETE_CONFIRM_WORD;

  const handleDelete = async () => {
    if (deleting || !confirmed) return;
    setDeleting(true);
    setDeleteFailed(false);
    const ok = await onDeleteAccount();
    // On success the app signs out and leaves this page, so only the failure path
    // needs to put the button back.
    if (!ok) {
      setDeleting(false);
      setDeleteFailed(true);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Your CV</h2>
        {hasCv ? (
          <>
            <p className="mt-3 inline-flex flex-wrap items-center gap-2 text-body text-foreground">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              CV on file
              <span className="font-mono text-caption text-muted-foreground">{wordCount.toLocaleString()} words</span>
              <button
                type="button"
                onClick={onReplaceCv}
                className="text-control font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Replace
              </button>
            </p>
            {uploaded && <p className="mt-1 text-caption text-muted-foreground">Uploaded {uploaded}</p>}
          </>
        ) : (
          <>
            <p className="mt-3 text-body text-muted-foreground text-pretty">
              <b className="text-foreground">No CV on file yet.</b> Drop your CV to see your match score for every
              live role.
            </p>
            <Button className="mt-4" onClick={onReplaceCv}>
              Add your CV
            </Button>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Target roles</h2>
        <p className="mt-1 text-caption text-muted-foreground">Pick up to {LABEL_CAP}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {ROLE_ARCHETYPES.map((r) => (
            <button
              key={r}
              type="button"
              className={roles.includes(r) ? CHIP_ON : CHIP_OFF}
              onClick={() => setEditRoles(toggleCapped(roles, r, LABEL_CAP))}
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Target industries</h2>
        <p className="mt-1 text-caption text-muted-foreground">Pick up to {LABEL_CAP}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {industryOptions.map((s) => (
            <button
              key={s}
              type="button"
              className={sectors.includes(s) ? CHIP_ON : CHIP_OFF}
              onClick={() => setEditSectors(toggleCapped(sectors, s, LABEL_CAP))}
            >
              {s}
            </button>
          ))}
        </div>
        {sectorOptions.length > TOP_SECTOR_CHIPS && (
          <div className="mt-4">
            <input
              type="text"
              placeholder="Search more industries…"
              value={sectorQuery}
              onChange={(e) => setSectorQuery(e.target.value)}
              className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-body text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/30"
            />
            {sectorQuery.trim() && (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-[10px] border border-border">
                {sectorSearchResults.map((o) => (
                  <li key={o.value}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-body text-foreground transition-colors hover:bg-secondary">
                      <input
                        type="checkbox"
                        checked={sectors.includes(o.value)}
                        onChange={() => setEditSectors(toggleCapped(sectors, o.value, LABEL_CAP))}
                      />
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className="font-mono text-caption text-muted-foreground">{o.count}</span>
                    </label>
                  </li>
                ))}
                {sectorSearchResults.length === 0 && (
                  <li className="px-3 py-2 text-caption text-muted-foreground">No matches</li>
                )}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Dismissed roles (issue #73 slice 4): saying no has to be undoable, or nobody
          uses it. Same section idiom as the pickers above; absent when empty. */}
      {dismissedJobs.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
          <h2 className="font-display text-section text-foreground">Not interested</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            These roles stay out of your queue and off the map. Put one back any time.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {dismissedJobs.map((job) => (
              <li key={job.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-micro uppercase text-muted-foreground">{job.company}</div>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-display text-body text-foreground underline-offset-2 hover:underline"
                  >
                    {job.title}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => onRestoreDismissed?.(job)}
                  className="shrink-0 text-control font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {savedFlash && (
          <span className="inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground" role="status">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Saved
          </span>
        )}
      </div>

      {/* Account (issue #84). Both surfaces are obligations, not extras: the product
          launches to European residents, who can ask for their data and ask us to
          delete it. The list of what goes comes from USER_DATA_TABLES, the same list
          the export reads, so the promise on screen and the code cannot drift. */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Your data</h2>
        <p className="mt-3 text-body text-muted-foreground text-pretty">
          Download everything we hold about you in one file. It's plain text in JSON format, so you can open it in
          any editor or load it into something else. The file is put together in your browser, from your own rows.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleExport} disabled={exporting}>
          {exporting ? "Preparing your file…" : "Download my data"}
        </Button>
        {exportFailed && (
          <p className="mt-3 text-caption text-muted-foreground" role="alert">
            We couldn't put your file together just now. Give it another try in a moment.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Delete your account</h2>
        <p className="mt-3 text-body text-muted-foreground text-pretty">
          This deletes your account and everything stored with it:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-body text-muted-foreground">
          {USER_DATA_TABLES.map((t) => (
            <li key={t.table}>{t.label}</li>
          ))}
        </ul>
        <p className="mt-3 text-body text-muted-foreground text-pretty">
          It happens straight away, it covers every one of those, and there's no undo. If you want to keep a copy,
          download your data first. You'll be signed out as soon as it's done.
        </p>

        {!confirmingDelete ? (
          <Button variant="destructive" className="mt-4" onClick={() => setConfirmingDelete(true)}>
            Delete my account
          </Button>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label htmlFor="delete-confirm" className="text-body text-foreground">
              Type <b>{DELETE_CONFIRM_WORD}</b> to confirm.
            </label>
            <input
              id="delete-confirm"
              type="text"
              autoComplete="off"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              className="w-full max-w-xs rounded-[10px] border border-border bg-background px-3 py-2 text-body text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/30"
            />
            <div className="flex items-center gap-3">
              <Button variant="destructive" onClick={handleDelete} disabled={!confirmed || deleting}>
                {deleting ? "Deleting…" : "Delete everything"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmingDelete(false);
                  setConfirmWord("");
                  setDeleteFailed(false);
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {deleteFailed && (
          <p className="mt-3 text-caption text-muted-foreground" role="alert">
            We couldn't finish deleting your account just now, so it's still here. Try again, or email
            hello@lifeinprogrezz.com and we'll do it by hand.
          </p>
        )}
      </section>

      {email && <p className="text-caption text-muted-foreground">Signed in as {email}</p>}
    </div>
  );
}
