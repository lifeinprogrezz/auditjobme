// Pins SettingsPanel — the /settings page body (Rober 7-25: settings graduated
// from the map's ProfileModal popup to a routed page; these are the SAME pinned
// states migrated from profile-modal.test.tsx). States that matter: no CV on
// file vs CV on file, Replace wiring, and the editable target roles / industries
// with Save persistence — a broken branch here strands preference editing.
//
// The account section (issue #84) is pinned here too, because it is a launch gate:
// the download has to be reachable, and the delete has to say what it destroys and
// refuse to fire on a stray click.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import SettingsPanel from "@/components/app/SettingsPanel";
import { USER_DATA_TABLES } from "@/lib/account";

function renderPanel(props: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const onReplaceCv = vi.fn();
  const onSaveTargets = vi.fn(async () => true);
  const onExportData = vi.fn(async () => true);
  const onDeleteAccount = vi.fn(async () => true);
  const onSaveConnections = vi.fn(async () => true);
  const onRemoveConnections = vi.fn(async () => true);
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
      {...props}
    />,
  );
  return { onReplaceCv, onSaveTargets, onExportData, onDeleteAccount, onSaveConnections, onRemoveConnections, ...utils };
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

  it("targets render pre-selected and Save persists the current picks", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    expect(onSaveTargets).toHaveBeenCalledTimes(1);
    expect(onSaveTargets).toHaveBeenCalledWith(["product"], ["Fintech"]);
  });

  it("toggling a chip changes what Save sends; failed save keeps the edits", async () => {
    const onSaveTargets = vi.fn(async () => false);
    renderPanel({
      cvText: "a CV",
      targetRoles: ["product"],
      targetSectors: [],
      onSaveTargets,
    });
    // Deselect the stored pick, then save — the edited (empty) list is sent.
    fireEvent.click(screen.getByRole("button", { name: "Product Manager" }));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
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

describe("SettingsPanel — account section (issue #84)", () => {
  beforeEach(() => cleanup());

  it("offers the download, and says so when it couldn't be built", async () => {
    const onExportData = vi.fn(async () => false);
    renderPanel({ onExportData });
    fireEvent.click(screen.getByRole("button", { name: /Download my data/i }));
    expect(onExportData).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't put your file together/i));
  });

  it("names every kind of data the delete destroys", () => {
    renderPanel();
    for (const spec of USER_DATA_TABLES) {
      expect(screen.getByText(spec.label)).toBeInTheDocument();
    }
  });

  // The list is keyed per ENTRY, not per table: referrals appears twice, once per
  // user column. Keyed by table alone it repeated a key, which React reports as an
  // error on every /settings load and which lets one line be dropped or reordered.
  it("keys the delete list per entry, so a table listed twice never repeats a key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPanel();
    const duplicateKeyWarnings = errors.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && /same key/i.test(a)),
    );
    expect(duplicateKeyWarnings).toEqual([]);
    errors.mockRestore();
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

describe("SettingsPanel — LinkedIn connections (issue #41)", () => {
  beforeEach(() => cleanup());

  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  const VALID_CSV = [
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    "Jane,Doe,https://www.linkedin.com/in/janedoe,,Spotify AB,Product Manager,07 Mar 2021",
  ].join("\n");

  it("no upload → explains the optional file, never a fabricated count", () => {
    renderPanel({ connectionsCount: 0 });
    expect(screen.getByText(/Your LinkedIn connections/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add your connections/i })).toBeInTheDocument();
    expect(screen.getByText(/never changes your match scores/i)).toBeInTheDocument();
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
