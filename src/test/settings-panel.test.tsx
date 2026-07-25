// Pins SettingsPanel — the /settings page body (Rober 7-25: settings graduated
// from the map's ProfileModal popup to a routed page; these are the SAME pinned
// states migrated from profile-modal.test.tsx). States that matter: no CV on
// file vs CV on file, Replace wiring, and the editable target roles / industries
// with Save persistence — a broken branch here strands preference editing.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SettingsPanel from "@/components/app/SettingsPanel";

function renderPanel(props: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const onReplaceCv = vi.fn();
  const onSaveTargets = vi.fn(async () => true);
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
      {...props}
    />,
  );
  return { onReplaceCv, onSaveTargets, ...utils };
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
      targetRoles: ["Product"],
      targetSectors: ["Fintech"],
      sectorOptions: [{ value: "Fintech", label: "Fintech", count: 12 }],
    });
    expect(screen.getByText(/Target roles/i)).toBeInTheDocument();
    expect(screen.getByText(/Target industries/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product" }).classList.contains("on")).toBe(true);
    expect(screen.getByRole("button", { name: "Fintech" }).classList.contains("on")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    expect(onSaveTargets).toHaveBeenCalledTimes(1);
    expect(onSaveTargets).toHaveBeenCalledWith(["Product"], ["Fintech"]);
  });

  it("toggling a chip changes what Save sends; failed save keeps the edits", async () => {
    const onSaveTargets = vi.fn(async () => false);
    renderPanel({
      cvText: "a CV",
      targetRoles: ["Product"],
      targetSectors: [],
      onSaveTargets,
    });
    // Deselect the stored pick, then save — the edited (empty) list is sent.
    fireEvent.click(screen.getByRole("button", { name: "Product" }));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    expect(onSaveTargets).toHaveBeenCalledWith([], []);
    await Promise.resolve();
    await Promise.resolve();
    // Save failed → the edit survives for the retry (chip still deselected).
    expect(screen.getByRole("button", { name: "Product" }).classList.contains("on")).toBe(false);
  });

  it("shows the signed-in identity caption", () => {
    renderPanel({ cvText: "a CV" });
    expect(screen.getByText(/Signed in as rober@example.com/i)).toBeInTheDocument();
  });
});
