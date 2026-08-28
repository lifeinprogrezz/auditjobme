// SettingsPanel — the pure, props-driven body of the /settings PAGE (Rober 7-25:
// settings graduated from the map's ProfileModal popup to a real routed surface,
// "a proper good definition on the app"). Same data contract the modal had, so the
// pinned states carry over: CV-on-file vs empty, Replace wiring, editable target
// roles / industries, Save persistence. Paper idiom throughout (§3.2 sections).
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  cvWordCount,
  formatUploadedDate,
  ROLE_PICKER_OPTIONS,
  ROLE_CAP,
  SECTOR_CAP,
  TOP_SECTOR_CHIPS,
  visibleSectorChips,
  filterSectorSearch,
} from "@/lib/labels";
import { parseConnectionsCsv, type ParsedConnection } from "@/lib/connections";
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
  /** The structured-CV editor (issue #150), rendered inside this section. Passed in
   *  as a node rather than imported: it owns its own reads and writes, and this panel
   *  stays pure and prop-driven, like the Forwarding and Referral sections do. */
  cvEditor?: ReactNode;
  /** Industries a user may PICK: the live catalog's sectors, gated on liquidity so
   *  a chosen one can actually return roles (issue #70). */
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
  /** Stored LinkedIn-connections rows (issue #41): 0 when nothing is uploaded. */
  connectionsCount: number;
  /** When the current connections upload landed. */
  connectionsUpdatedAt: string | null;
  /** Persist a freshly parsed Connections.csv (replaces any stored upload). */
  onSaveConnections: (rows: ParsedConnection[]) => Promise<boolean>;
  /** Remove the whole upload; every warm marker disappears with it. */
  onRemoveConnections: () => Promise<boolean>;
};

/** The word someone has to type before the delete button does anything. */
export const DELETE_CONFIRM_WORD = "delete";

/** Read an uploaded file as text; FileReader fallback for environments whose
 *  File lacks .text() (older WebKit, jsdom). */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsText(file);
  });
}

/** Toggle a value in/out of a capped list — ignores extra picks past the cap. */
function toggleCapped(list: string[], value: string, cap: number): string[] {
  if (list.includes(value)) return list.filter((v) => v !== value);
  if (list.length >= cap) return list;
  return [...list, value];
}

// One chip idiom for both pickers: control type, hairline border, and a filled
// ink "on" state (the literal class name "on" is part of the pinned contract).
const CHIP_OFF =
  "rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground";
const CHIP_ON = "on rounded-full border border-foreground bg-foreground px-3 py-1.5 text-control font-medium text-background";

export default function SettingsPanel({
  cvText,
  cvEditor,
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
  connectionsCount,
  connectionsUpdatedAt,
  onSaveConnections,
  onRemoveConnections,
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
  // "Not interested" (issue #156): collapsed by default so a long list doesn't
  // dominate the page; the count sits in the header either way.
  const [notInterestedOpen, setNotInterestedOpen] = useState(false);

  // Connections upload (issue #41): file is read + parsed HERE (pure lib), the
  // parent only persists rows — so the panel stays testable without a network.
  const [connBusy, setConnBusy] = useState(false);
  const [connError, setConnError] = useState("");
  const connFileRef = useRef<HTMLInputElement>(null);

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

  const handleConnectionsFile = async (file: File | undefined) => {
    if (!file || connBusy) return;
    setConnBusy(true);
    setConnError("");
    try {
      const rows = parseConnectionsCsv(await readFileText(file));
      if (rows.length === 0) {
        setConnError(
          "We couldn't read connections from that file. It should be the Connections.csv file from your LinkedIn download, unchanged.",
        );
        return;
      }
      const ok = await onSaveConnections(rows);
      if (!ok) setConnError("We couldn't save your connections just now. Give it another try in a moment.");
    } catch {
      setConnError("We couldn't read that file. Give it another try.");
    } finally {
      setConnBusy(false);
    }
  };

  const handleRemoveConnections = async () => {
    if (connBusy) return;
    setConnBusy(true);
    setConnError("");
    const ok = await onRemoveConnections();
    if (!ok) setConnError("We couldn't remove your connections just now. Give it another try in a moment.");
    setConnBusy(false);
  };

  const connectionsUploaded = formatUploadedDate(connectionsUpdatedAt);

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
            {cvEditor}
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
        <p className="mt-4 text-caption text-muted-foreground">
          Changing this re-scores your roles over the next hours; you keep your current scores meanwhile.
        </p>
      </section>

      {/* LinkedIn connections upload (issue #41). Optional, alongside the CV — the
          user's own export of their own network, treated with the CV's privacy
          posture. The match is information on the cards, never a score change. */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="inline-flex items-center gap-2 font-display text-section text-foreground">
          Your LinkedIn connections
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="How your connections are used"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border font-mono text-caption text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                i
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 text-caption text-muted-foreground" align="start">
              <p className="text-pretty">
                <b className="text-foreground">Getting the file:</b> on LinkedIn, open Settings &amp; Privacy, then
                Data privacy, then "Get a copy of your data", and tick Connections. LinkedIn emails you a small file
                called Connections.csv.
              </p>
              <p className="mt-2 text-pretty">
                <b className="text-foreground">What we do with it:</b> we keep the list with your account and match
                company names, so roles can show who you already know. Only you can see it. It never changes your
                match scores, we never contact anyone on it, it's part of your data download, and deleting it here or
                deleting your account removes it completely.
              </p>
            </PopoverContent>
          </Popover>
        </h2>
        <input
          ref={connFileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // allow re-selecting the same file
            void handleConnectionsFile(f);
          }}
        />
        {connectionsCount > 0 ? (
          <>
            <p className="mt-3 inline-flex flex-wrap items-center gap-2 text-body text-foreground">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Connections on file
              <span className="font-mono text-caption text-muted-foreground">
                {connectionsCount.toLocaleString()} people
              </span>
              <button
                type="button"
                onClick={() => connFileRef.current?.click()}
                disabled={connBusy}
                className="text-control font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={handleRemoveConnections}
                disabled={connBusy}
                className="text-control font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Remove
              </button>
            </p>
            {connectionsUploaded && (
              <p className="mt-1 text-caption text-muted-foreground">Uploaded {connectionsUploaded}</p>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-body text-muted-foreground text-pretty">
              <b className="text-foreground">Optional.</b> Upload your LinkedIn Connections.csv and roles where you
              know someone get a quiet marker.
            </p>
            <Button className="mt-4" onClick={() => connFileRef.current?.click()} disabled={connBusy}>
              {connBusy ? "Reading your file…" : "Add your connections"}
            </Button>
          </>
        )}
        {connError && (
          <p className="mt-3 text-caption text-muted-foreground" role="alert">
            {connError}
          </p>
        )}
      </section>

      {/* ONE card for both pickers and the save button (Rober, walking it 2026-08-28).
          Two bordered cards with the button floating under them read as two
          independent settings, so "Save targets" looked like it belonged to
          industries alone. It always saved both; the layout said otherwise. */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Targets</h2>
        <h3 className="mt-4 font-display text-foreground">Target roles</h3>
        <p className="mt-1 text-caption text-muted-foreground">Pick up to {ROLE_CAP}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {ROLE_PICKER_OPTIONS.map((r) => {
            const selected = roles.includes(r.value);
            const capped = !selected && roles.length >= ROLE_CAP;
            return (
              <button
                key={r.value}
                type="button"
                disabled={capped}
                className={selected ? CHIP_ON : CHIP_OFF}
                onClick={() => setEditRoles(toggleCapped(roles, r.value, ROLE_CAP))}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <h3 className="mt-6 font-display text-foreground">Target industries</h3>
        <p className="mt-1 text-caption text-muted-foreground">Pick up to {SECTOR_CAP}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {industryOptions.map((s) => {
            const selected = sectors.includes(s);
            const capped = !selected && sectors.length >= SECTOR_CAP;
            return (
              <button
                key={s}
                type="button"
                disabled={capped}
                className={selected ? CHIP_ON : CHIP_OFF}
                onClick={() => setEditSectors(toggleCapped(sectors, s, SECTOR_CAP))}
              >
                {s}
              </button>
            );
          })}
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
                {sectorSearchResults.map((o) => {
                  const selected = sectors.includes(o.value);
                  const capped = !selected && sectors.length >= SECTOR_CAP;
                  return (
                    <li key={o.value}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-body text-foreground transition-colors hover:bg-secondary">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={capped}
                          onChange={() => setEditSectors(toggleCapped(sectors, o.value, SECTOR_CAP))}
                        />
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <span className="font-mono text-caption text-muted-foreground">{o.count}</span>
                      </label>
                    </li>
                  );
                })}
                {sectorSearchResults.length === 0 && (
                  <li className="px-3 py-2 text-caption text-muted-foreground">No matches</li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Inside the card, under BOTH pickers: it saves roles and industries
            together, and being outside made it look like it saved only the last
            one (issue #156 put it here; 2026-08-28 moved it in). */}
        <p className="mt-6 text-caption text-muted-foreground">
          Changing this re-scores your roles over the next hours; you keep your current scores meanwhile.
        </p>
        <div className="mt-3 flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save targets"}
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
      </section>

      {/* Dismissed roles (issue #73 slice 4): saying no has to be undoable, or nobody
          uses it. Collapsible and collapsed by default (issue #156) so a long list
          doesn't dominate the page; the count in the header says it's there —
          same Fold idiom as CvEditor's per-section folds. */}
      {dismissedJobs.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
          <button
            type="button"
            onClick={() => setNotInterestedOpen((o) => !o)}
            aria-expanded={notInterestedOpen}
            className="flex w-full items-center justify-between text-left"
          >
            <h2 className="font-display text-section text-foreground">
              Not interested{" "}
              <span className="font-mono text-caption text-muted-foreground">{dismissedJobs.length}</span>
            </h2>
            <span className="font-mono text-caption text-muted-foreground">
              {notInterestedOpen ? "Hide" : "Show"}
            </span>
          </button>
          {notInterestedOpen && (
            <>
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
            </>
          )}
        </section>
      )}

      {/* Account (issue #84, restructured #156): download and delete, as two rows
          of one "Your data" section rather than two sections. The full list of
          what "everything" covers moved to the Privacy page, generated from the
          same USER_DATA_TABLES the export reads, so the promise there and the
          code cannot drift. */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
        <h2 className="font-display text-section text-foreground">Your data</h2>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-body text-foreground">Download my data</p>
            <p className="mt-1 text-caption text-muted-foreground text-pretty">
              Everything we hold about you, in one file, put together in your browser.
            </p>
          </div>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? "Preparing your file…" : "Download my data"}
          </Button>
        </div>
        {exportFailed && (
          <p className="mt-3 text-caption text-muted-foreground" role="alert">
            We couldn't put your file together just now. Give it another try in a moment.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <div>
            <p className="text-body text-foreground">Delete my account</p>
            <p className="mt-1 text-caption text-muted-foreground text-pretty">
              Deletes your account and all data linked to it, straight away, no undo.
              <br />
              Download your data first if you want a copy.
            </p>
          </div>
          {!confirmingDelete && (
            <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
              Delete my account
            </Button>
          )}
        </div>

        {confirmingDelete && (
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
