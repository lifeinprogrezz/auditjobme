// CvEditor — "what we read from your CV", inside the Settings "Your CV" section.
//
// Issue #150: the tailored CV is rendered from a structured profile parsed once from
// the upload. A parse can misread a layout, so the person who owns the CV gets to
// correct it, and the correction is what prints from then on. Self-contained like
// ForwardingSection and ReferralSection: it owns its own reads and writes, so the
// pure SettingsPanel and its pinned test stay as they are.
//
// Nothing here calls a language model except "Read my CV again", which re-runs the
// same one parse. Saving is a plain write of the fields below.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ensureCvStructured, parseAndSaveCv, saveCvStructured } from "@/lib/cvParse";
import type { CvStructured } from "@/lib/cvStructured";
import { DEV_FIXTURE, DEV_FIXTURE_CV_STRUCTURED } from "@/lib/devFixture";

type Props = {
  userId: string;
  /** The stored CV text. Without one there is nothing to read or to correct. */
  cvText: string | null;
};

const FIELD = "h-9 rounded-[10px] border-border bg-background text-control";
const AREA = "min-h-[60px] rounded-[10px] border-border bg-background text-control";
const LABEL = "text-caption text-muted-foreground";
const GHOST_BUTTON =
  "text-control font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground";

/** One labelled field. Plain input, label above, no floating-label cleverness. */
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <Input className={FIELD} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A section that opens and closes, so a long CV stays readable. */
function Fold({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-display text-control text-foreground">
          {title} <span className="font-mono text-caption text-muted-foreground">{count}</span>
        </span>
        <span className="font-mono text-caption text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="mt-3 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

export default function CvEditor({ userId, cvText }: Props) {
  const [cv, setCv] = useState<CvStructured | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "reparse">(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    // No CV on file means nothing to read and nothing to pay a parse for.
    if (!cvText?.trim()) {
      setCv(null);
      setLoading(false);
      return;
    }
    // Dev-only (lib/devFixture.ts): the E2E-bypass mock user has no profiles row and
    // no JWT, so the read comes back failed and this panel can only ever show its
    // "not read yet" state — the fielded editor was unwalkable. Seed the synthetic
    // structure instead: no database read, no parse call. The gate folds out of a
    // production build.
    if (DEV_FIXTURE) {
      setCv(structuredClone(DEV_FIXTURE_CV_STRUCTURED));
      setLoading(false);
      return;
    }
    setLoading(true);
    void ensureCvStructured(userId, cvText).then((parsed) => {
      if (!active) return;
      setCv(parsed);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [userId, cvText]);

  /** Every edit goes through here: replace the whole profile, never mutate it. */
  const edit = useCallback((change: (draft: CvStructured) => void) => {
    setStatus("");
    setCv((current) => {
      if (!current) return current;
      const next = JSON.parse(JSON.stringify(current)) as CvStructured;
      change(next);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!cv || busy) return;
    setBusy("save");
    // Under the dev fixture there is no row to write to, so the write is skipped and
    // the edit stays on screen — the Save step is walkable without a database write.
    const ok = DEV_FIXTURE ? true : await saveCvStructured(userId, cv);
    setStatus(ok ? "Saved. Your next tailored CV uses this." : "We couldn't save that. Give it another try in a moment.");
    setBusy(null);
  };

  const handleReparse = async () => {
    if (!cvText?.trim() || busy) return;
    setBusy("reparse");
    setStatus("");
    // Same dev-fixture gate as the load: re-reading is the fixture again, never a
    // paid parse call the mock user has no session to make.
    const parsed = DEV_FIXTURE ? structuredClone(DEV_FIXTURE_CV_STRUCTURED) : await parseAndSaveCv(userId, cvText);
    if (parsed) {
      setCv(parsed);
      setStatus("Read again from your CV.");
    } else {
      setStatus("We couldn't read your CV again just now. Your saved version is still here.");
    }
    setBusy(null);
  };

  if (!cvText?.trim()) return null;

  if (loading) {
    return (
      <p className="mt-4 text-caption text-muted-foreground" role="status">
        Reading your CV…
      </p>
    );
  }

  if (!cv) {
    return (
      <div className="mt-4">
        <p className="text-caption text-muted-foreground text-pretty">
          We haven't read your CV into sections yet, so your tailored CV prints as plain text for now.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={handleReparse} disabled={busy !== null}>
          {busy === "reparse" ? "Reading…" : "Read my CV again"}
        </Button>
        {status && <p className="mt-2 text-caption text-muted-foreground">{status}</p>}
      </div>
    );
  }

  const contact = cv.contact;

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div>
        <h3 className="font-display text-control text-foreground">What we read from your CV</h3>
        <p className="mt-1 text-caption text-muted-foreground text-pretty">
          This is what your tailored CV prints. Everything here comes from your own upload, word for word. Fix anything
          we read wrong and the next download uses your version.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" value={contact.name} onChange={(v) => edit((d) => void (d.contact.name = v))} />
        <Field label="Location" value={contact.location ?? ""} onChange={(v) => edit((d) => void (d.contact.location = v))} />
        <Field label="Email" value={contact.email ?? ""} onChange={(v) => edit((d) => void (d.contact.email = v))} />
        <Field label="Phone" value={contact.phone ?? ""} onChange={(v) => edit((d) => void (d.contact.phone = v))} />
      </div>

      <Fold title="Links" count={contact.links.length}>
        {contact.links.map((link, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className={FIELD}
              value={link}
              aria-label={`Link ${i + 1}`}
              onChange={(e) => edit((d) => void (d.contact.links[i] = e.target.value))}
            />
            <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.contact.links.splice(i, 1))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.contact.links.push(""))}>
          Add a link
        </button>
      </Fold>

      <Fold title="Experience" count={cv.experience.length}>
        {cv.experience.map((job, i) => (
          <div key={i} className="rounded-[12px] border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company" value={job.company} onChange={(v) => edit((d) => void (d.experience[i].company = v))} />
              <Field label="Role" value={job.role} onChange={(v) => edit((d) => void (d.experience[i].role = v))} />
              <Field label="From" value={job.start} onChange={(v) => edit((d) => void (d.experience[i].start = v))} />
              <Field label="To" value={job.end} onChange={(v) => edit((d) => void (d.experience[i].end = v))} />
              <Field
                label="Location"
                value={job.location ?? ""}
                onChange={(v) => edit((d) => void (d.experience[i].location = v))}
              />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <span className={LABEL}>What you did</span>
              {job.bullets.map((bullet, b) => (
                <div key={b} className="flex items-start gap-2">
                  <Textarea
                    className={AREA}
                    value={bullet}
                    aria-label={`Bullet ${b + 1} at ${job.company || job.role}`}
                    onChange={(e) => edit((d) => void (d.experience[i].bullets[b] = e.target.value))}
                  />
                  <button
                    type="button"
                    className={`${GHOST_BUTTON} mt-2`}
                    onClick={() => edit((d) => void d.experience[i].bullets.splice(b, 1))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-4">
                <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.experience[i].bullets.push(""))}>
                  Add a bullet
                </button>
                <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.experience.splice(i, 1))}>
                  Remove this job
                </button>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={GHOST_BUTTON}
          onClick={() => edit((d) => void d.experience.push({ company: "", role: "", start: "", end: "", bullets: [""] }))}
        >
          Add a job
        </button>
      </Fold>

      <Fold title="Education" count={cv.education.length}>
        {cv.education.map((school, i) => (
          <div key={i} className="rounded-[12px] border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="School" value={school.school} onChange={(v) => edit((d) => void (d.education[i].school = v))} />
              <Field label="Qualification" value={school.degree} onChange={(v) => edit((d) => void (d.education[i].degree = v))} />
              <Field label="From" value={school.start ?? ""} onChange={(v) => edit((d) => void (d.education[i].start = v))} />
              <Field label="To" value={school.end ?? ""} onChange={(v) => edit((d) => void (d.education[i].end = v))} />
              <Field
                label="Location"
                value={school.location ?? ""}
                onChange={(v) => edit((d) => void (d.education[i].location = v))}
              />
            </div>
            <button
              type="button"
              className={`${GHOST_BUTTON} mt-3`}
              onClick={() => edit((d) => void d.education.splice(i, 1))}
            >
              Remove this entry
            </button>
          </div>
        ))}
        <button
          type="button"
          className={GHOST_BUTTON}
          onClick={() => edit((d) => void d.education.push({ school: "", degree: "", start: "", end: "" }))}
        >
          Add an entry
        </button>
      </Fold>

      <Fold title="Skills" count={cv.skills.length}>
        {cv.skills.map((group, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-[12px] border border-border p-3">
            <Field label="Group" value={group.group} onChange={(v) => edit((d) => void (d.skills[i].group = v))} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Items, separated by commas</span>
              <Textarea
                className={AREA}
                value={group.items.join(", ")}
                onChange={(e) =>
                  edit((d) => {
                    d.skills[i].items = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                  })
                }
              />
            </label>
            <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.skills.splice(i, 1))}>
              Remove this group
            </button>
          </div>
        ))}
        <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.skills.push({ group: "", items: [] }))}>
          Add a group
        </button>
      </Fold>

      <Fold title="Anything else" count={cv.extras.length}>
        {cv.extras.map((extra, i) => (
          <div key={i} className="flex items-start gap-2">
            <Textarea
              className={AREA}
              value={extra}
              aria-label={`Extra line ${i + 1}`}
              onChange={(e) => edit((d) => void (d.extras[i] = e.target.value))}
            />
            <button type="button" className={`${GHOST_BUTTON} mt-2`} onClick={() => edit((d) => void d.extras.splice(i, 1))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={GHOST_BUTTON} onClick={() => edit((d) => void d.extras.push(""))}>
          Add a line
        </button>
      </Fold>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button size="sm" onClick={handleSave} disabled={busy !== null}>
          {busy === "save" ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleReparse} disabled={busy !== null}>
          {busy === "reparse" ? "Reading…" : "Read my CV again"}
        </Button>
        {status && (
          <span className="text-caption text-muted-foreground" role="status">
            {status}
          </span>
        )}
      </div>
      <p className="text-caption text-muted-foreground text-pretty">
        Reading it again replaces everything above with a fresh pass over your upload, so any change you made here goes.
      </p>
    </div>
  );
}
