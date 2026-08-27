// Pins SettingsPanel — the /settings page body (Rober 7-25: settings graduated
// from the map's ProfileModal popup to a routed page; these are the SAME pinned
// states migrated from profile-modal.test.tsx). States that matter: no CV on
// file vs CV on file, Replace wiring, and the editable target roles / industries
// with Save persistence — a broken branch here strands preference editing.
//
// The account section (issue #84, restructured #156) is pinned here too, because
// it is a launch gate: the download has to be reachable, and the delete has to
// say what it does and refuse to fire on a stray click. The full "what gets
// deleted" list moved to the Privacy page (src/test/privacy.test.tsx) — it is no
// longer rendered here.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import SettingsPanel from "@/components/app/SettingsPanel";
import type { RoleJob } from "@/lib/roles";

// Minimal RoleJob factory — only the fields "Not interested" reads matter
// (same idiom as labels.test.ts).
function job(partial: Partial<RoleJob> & { id: string; title: string; company: string }): RoleJob {
  return {
    url: "https://example.com",
    location: null,
    remote: false,
    source: null,
    seniority: null,
    posted_at: null,
    score: null,
    reason: null,
    ...partial,
  } as RoleJob;
}

function renderPanel(props: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const onReplaceCv = vi.fn();
  const onSaveTargets = vi.fn(async () => true);
  const onExportData = vi.fn(async () => true);
  const onDeleteAccount = vi.fn(async () => true);
  const onSaveConnections = vi.fn(async () => true);
  const onRemoveConnections = vi.fn(async () => true);
  const onRestoreDismissed = vi.fn();
  const utils = render(
    <SettingsPanel
      cvText={null}
      targetRoles={[]}
      targetSectors={[]}
      cvUpdatedAt={null}
      onReplaceCv={onReplaceCv}
      sectorOptions={[]}
      onSaveTargets={onSaveTargets}
      email="rober@example.com"
      onExportData={onExportData}
      onDeleteAccount={onDeleteAccount}
      connectionsCount={0}
      connectionsUpdatedAt={null}
      onSaveConnections={onSaveConnections}
      onRemoveConnections={onRemoveConnections}
      onRestoreDismissed={onRestoreDismissed}
      {...props}
    />,
  );
  return {
    onReplaceCv,
    onSaveTargets,
    onExportData,
    onDeleteAccount,
    onSaveConnections,
    onRemoveConnections,
    onRestoreDismissed,
    ...utils,
  };
}

describe("SettingsPanel", () => {
  beforeEach(() => cleanup());

  it("empty-CV → shows the add-CV prompt, not a fabricated word count", () => {
    const { onReplaceCv } = renderPanel({ cvText: null });
    expect(screen.getByText(/No CV on file yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Replace$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/words/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add your CV/i }));
    expect(onReplaceCv).toHaveBeenCalledTimes(1);
  });

  it("CV-on-file → shows the word count, upload date, and Replace wiring", () => {
    const { onReplaceCv } = renderPanel({
      cvText: "one two three four five",
      cvUpdatedAt: "2026-07-10T09:00:00.000Z",
    });
    expect(screen.getByText(/CV on file/i)).toBeInTheDocument();
    expect(screen.getByText(/5 words/i)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded/i)).toHaveTextContent("Jul 2026");
    fireEvent.click(screen.getByRole("button", { name: /^Replace$/i }));
    expect(onReplaceCv).toHaveBeenCalledTimes(1);
  });

  it("the honest re-score line appears under the CV and under the targets (issue #156)", () => {
    renderPanel({ cvText: "a CV" });
    const lines = screen.getAllByText(
      /Changing this re-scores your roles over the next hours; you keep your current scores meanwhile\./i,
    );
    expect(lines).toHaveLength(2);
  });

  it("targets render pre-selected and Save targets persists the current picks", () => {
    const { onSaveTargets } = renderPanel({
      cvText: "a CV",
      // The chip VALUE is the stored jobs.role_family, the chip LABEL is what the
      // user reads (issue #70) — the two must not be the same string.
      targetRoles: ["product"],
      targetSectors: ["Fintech"],
      sectorOptions: [{ value: "Fintech", label: "Fintech", count: 12 }],
    });
    expect(screen.getByText(/Target roles/i)).toBeInTheDocument();
    expect(screen.getByText(/Target industries/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product Manager" }).classList.contains("on")).toBe(true);
    expect(screen.getByRole("button", { name: "Fintech" }).classList.contains("on")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Save targets/i }));
    expect(onSaveTargets).toHaveBeenCalledTimes(1);
    expect(onSaveTargets).toHaveBeenCalledWith(["product"], ["Fintech"]);
  });

  it("toggling a chip changes what Save targets sends; failed save keeps the edits", async () => {
    const onSaveTargets = vi.fn(async () => false);
    renderPanel({
      cvText: "a CV",
      targetRoles: ["product"],
      targetSectors: [],
      onSaveTargets,
    });
    // Deselect the stored pick, then save — the edited (empty) list is sent.
    fireEvent.click(screen.getByRole("button", { name: "Product Manager" }));
    fireEvent.click(screen.getByRole("button", { name: /Save targets/i }));
    expect(onSaveTargets).toHaveBeenCalledWith([], []);
    await Promise.resolve();
    await Promise.resolve();
    // Save failed → the edit survives for the retry (chip still deselected).
    expect(screen.getByRole("button", { name: "Product Manager" }).classList.contains("on")).toBe(false);
  });

  it("shows the signed-in identity caption", () => {
    renderPanel({ cvText: "a CV" });
    expect(screen.getByText(/Signed in as rober@example.com/i)).toBeInTheDocument();
  });
});

describe("SettingsPanel — target caps (issue #156, LOCKED decision 1)", () => {
  beforeEach(() => cleanup());

  it("roles cap at 2: a third pick stays disabled, never a silently dropped click", () => {
    const { onSaveTargets } = renderPanel({ cvText: "a CV" });
    expect(screen.getByText("Pick up to 2.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Product Manager" }));
    fireEvent.click(screen.getByRole("button", { name: "Engineering" }));
    const third = screen.getByRole("button", { name: "Sales" });
    expect(third).toBeDisabled();

    fireEvent.click(third);
    expect(third.classList.contains("on")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Save targets/i }));
    expect(onSaveTargets).toHaveBeenCalledWith(["product", "engineering"], []);
  });

  it("industries cap at 3: a fourth pick stays disabled", () => {
    const sectorOptions = [
      { value: "Fintech", label: "Fintech", count: 12 },
      { value: "Healthtech", label: "Healthtech", count: 9 },
      { value: "Gaming", label: "Gaming", count: 7 },
      { value: "Fashion", label: "Fashion", count: 5 },
    ];
    const { onSaveTargets } = renderPanel({ cvText: "a CV", sectorOptions });
    expect(screen.getByText("Pick up to 3.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fintech" }));
    fireEvent.click(screen.getByRole("button", { name: "Healthtech" }));
    fireEvent.click(screen.getByRole("button", { name: "Gaming" }));
    const fourth = screen.getByRole("button", { name: "Fashion" });
    expect(fourth).toBeDisabled();

    fireEvent.click(fourth);
    expect(fourth.classList.contains("on")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Save targets/i }));
    expect(onSaveTargets).toHaveBeenCalledWith([], ["Fintech", "Healthtech", "Gaming"]);
  });

  it("a chip already selected stays enabled at the cap, so it can still be deselected", () => {
    renderPanel({ cvText: "a CV", targetRoles: ["product", "engineering"] });
    const selected = screen.getByRole("button", { name: "Product Manager" });
    expect(selected).not.toBeDisabled();
    fireEvent.click(selected);
    expect(selected.classList.contains("on")).toBe(false);
  });
});

describe("SettingsPanel — Not interested (issue #156)", () => {
  beforeEach(() => cleanup());

  const dismissedJobs = [
    job({ id: "1", company: "Doist", title: "Growth PM" }),
    job({ id: "2", company: "Cabify", title: "Associate PM" }),
  ];

  it("renders nothing when there is nothing dismissed", () => {
    renderPanel({ dismissedJobs: [] });
    expect(screen.queryByText(/Not interested/i)).not.toBeInTheDocument();
  });

  it("is collapsed by default, with the count in the header", () => {
    renderPanel({ dismissedJobs });
    const toggle = screen.getByRole("button", { name: /Not interested/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2");
    expect(screen.queryByText("Doist")).not.toBeInTheDocument();
  });

  it("opens on click to show the list, and Undo restores a role", () => {
    const { onRestoreDismissed } = renderPanel({ dismissedJobs });
    fireEvent.click(screen.getByRole("button", { name: /Not interested/i }));
    expect(screen.getByText("Doist")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Undo/i })[0]);
    expect(onRestoreDismissed).toHaveBeenCalledWith(dismissedJobs[0]);
  });
});

describe("SettingsPanel — account section (issue #84, restructured #156)", () => {
  beforeEach(() => cleanup());

  it("is one 'Your data' section with a Download row and a Delete row, not two sections", () => {
    renderPanel();
    expect(screen.getAllByText("Your data")).toHaveLength(1);
    expect(screen.queryByText("Delete your account")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download my data/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete my account/i })).toBeInTheDocument();
  });

  it("offers the download, and says so when it couldn't be built", async () => {
    const onExportData = vi.fn(async () => false);
    renderPanel({ onExportData });
    fireEvent.click(screen.getByRole("button", { name: /Download my data/i }));
    expect(onExportData).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't put your file together/i));
  });

  it("the delete copy is the two short lines, not the full table list", () => {
    renderPanel();
    expect(
      screen.getByText(/Deletes your account and all data linked to it, straight away, no undo\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Download your data first if you want a copy\./i)).toBeInTheDocument();
    // The 19-bullet table list moved to the Privacy page (privacy.test.tsx).
    expect(screen.queryByText(/your profile and the text of your CV/i)).not.toBeInTheDocument();
  });

  it("a single click never deletes: confirmation is typed, and the wrong word stays disabled", () => {
    const { onDeleteAccount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));
    expect(onDeleteAccount).not.toHaveBeenCalled();

    const confirmButton = screen.getByRole("button", { name: /Delete everything/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), { target: { value: "yes" } });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(onDeleteAccount).not.toHaveBeenCalled();
  });

  it("the typed word (any case) unlocks the delete, and Cancel backs out clean", () => {
    const { onDeleteAccount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), { target: { value: " DELETE " } });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    // Backing out returns the section to its resting state, with the word cleared.
    expect(screen.queryByRole("button", { name: /Delete everything/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));
    expect(screen.getByRole("button", { name: /Delete everything/i })).toBeDisabled();
    expect(onDeleteAccount).not.toHaveBeenCalled();
  });

  it("confirmed delete fires once, and a failure says the account is still there", async () => {
    const onDeleteAccount = vi.fn(async () => false);
    renderPanel({ onDeleteAccount });
    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: /Delete everything/i }));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/still here/i));
  });
});

describe("SettingsPanel — LinkedIn connections (issue #41, copy cut #156)", () => {
  beforeEach(() => cleanup());

  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  const VALID_CSV = [
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    "Jane,Doe,https://www.linkedin.com/in/janedoe,,Spotify AB,Product Manager,07 Mar 2021",
  ].join("\n");

  it("no upload → the one-line explanation, never a fabricated count", () => {
    renderPanel({ connectionsCount: 0 });
    expect(screen.getByRole("heading", { name: /Your LinkedIn connections/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add your connections/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Upload your LinkedIn Connections\.csv and roles where you know someone get a quiet marker\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/people$/i)).not.toBeInTheDocument();
  });

  it("a valid Connections.csv is parsed in the panel and handed over as rows", async () => {
    const { onSaveConnections } = renderPanel({ connectionsCount: 0 });
    const file = new File([VALID_CSV], "Connections.csv", { type: "text/csv" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => expect(onSaveConnections).toHaveBeenCalledTimes(1));
    expect(onSaveConnections).toHaveBeenCalledWith([
      expect.objectContaining({ fullName: "Jane Doe", company: "Spotify AB", companyKey: "spotify" }),
    ]);
  });

  it("a file that is not a Connections.csv is refused with a readable error", async () => {
    const { onSaveConnections } = renderPanel({ connectionsCount: 0 });
    const file = new File(["nothing,useful\nhere,either"], "resume.csv", { type: "text/csv" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't read connections/i));
    expect(onSaveConnections).not.toHaveBeenCalled();
  });

  it("upload on file → shows the count, Replace, and a working Remove", async () => {
    const { onRemoveConnections } = renderPanel({
      connectionsCount: 1234,
      connectionsUpdatedAt: "2026-08-01T09:00:00.000Z",
    });
    expect(screen.getByText(/Connections on file/i)).toBeInTheDocument();
    expect(screen.getByText(/1,234 people/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Replace$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));
    await waitFor(() => expect(onRemoveConnections).toHaveBeenCalledTimes(1));
  });
});

// Issue #158: onboarding can store "other", so Settings must render it as a chip
// the owner can unpick — otherwise the pick is invisible, the cap is already met
// by one visible chip, and every later save re-persists it (the trap the reviewer
// caught before merge). One shared ROLE_PICKER_OPTIONS now feeds both pickers.
describe("Other role chip in Settings (issue #158)", () => {
  it("renders Other as selected and lets it be unpicked", () => {
    const { onSaveTargets } = renderPanel({
      cvText: "a CV",
      targetRoles: ["product", "other"],
      targetSectors: [],
    });
    const other = screen.getByRole("button", { name: "Other" });
    expect(other.classList.contains("on")).toBe(true);
    fireEvent.click(other);
    fireEvent.click(screen.getByRole("button", { name: /Save targets/i }));
    expect(onSaveTargets).toHaveBeenCalledWith(["product"], []);
  });
});
