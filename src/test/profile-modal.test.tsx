// Pins ProfileModal (issue #43 surface, hardened in #54; Settings added Rober 7-15):
// the avatar's real destination for a signed-in user. States that matter — no CV on
// file, a CV on file, sign-out wiring, and the Settings sub-view where target roles /
// industries are now EDITED (they no longer render as read-only chips in the profile
// view) — because a broken branch here is a dead-end the map shell can't recover from.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProfileModal from "@/components/roles/ProfileModal";

const signOut = vi.fn(async () => {});
let mockUser: { email?: string } | null = { email: "rober@example.com" };

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, session: null, loading: false, signOut }),
}));

function renderModal(props: Partial<React.ComponentProps<typeof ProfileModal>> = {}) {
  const onClose = vi.fn();
  const onReplaceCv = vi.fn();
  const onSaveTargets = vi.fn(async () => {});
  const utils = render(
    <MemoryRouter>
      <ProfileModal
        open
        onClose={onClose}
        cvText={null}
        targetRoles={[]}
        targetSectors={[]}
        cvUpdatedAt={null}
        onReplaceCv={onReplaceCv}
        sectorOptions={[]}
        onSaveTargets={onSaveTargets}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onClose, onReplaceCv, onSaveTargets, ...utils };
}

describe("ProfileModal", () => {
  beforeEach(() => {
    signOut.mockClear();
    mockUser = { email: "rober@example.com" };
    cleanup();
  });

  it("closed → renders nothing", () => {
    const { container } = render(
      <MemoryRouter>
        <ProfileModal
          open={false}
          onClose={vi.fn()}
          cvText="anything"
          targetRoles={[]}
          targetSectors={[]}
          cvUpdatedAt={null}
          onReplaceCv={vi.fn()}
          sectorOptions={[]}
          onSaveTargets={vi.fn(async () => {})}
        />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("empty-CV → shows the add-CV prompt, not a fabricated word count", () => {
    const { onReplaceCv } = renderModal({ cvText: null });
    expect(screen.getByText(/No CV on file yet/i)).toBeInTheDocument();
    // The loaded-state affordances are absent: no Replace button, no fabricated word count.
    expect(screen.queryByRole("button", { name: /^Replace$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/words/i)).not.toBeInTheDocument();
    // Add-CV routes into the shared unlock flow.
    fireEvent.click(screen.getByRole("button", { name: /Add your CV/i }));
    expect(onReplaceCv).toHaveBeenCalledTimes(1);
  });

  it("CV-on-file → shows the word count, upload date, and Replace wiring", () => {
    const { onReplaceCv } = renderModal({
      cvText: "one two three four five",
      cvUpdatedAt: "2026-07-10T09:00:00.000Z",
    });
    expect(screen.getByText(/CV on file/i)).toBeInTheDocument();
    expect(screen.getByText(/5 words/i)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded/i)).toHaveTextContent("Jul 2026");
    fireEvent.click(screen.getByRole("button", { name: /^Replace$/i }));
    expect(onReplaceCv).toHaveBeenCalledTimes(1);
  });

  it("sign-out wiring → calls signOut then closes the modal", async () => {
    const { onClose } = renderModal({ cvText: "a CV" });
    fireEvent.click(screen.getByRole("button", { name: /Sign out/i }));
    // handleSignOut awaits signOut before onClose — flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Settings → targets are edited here (not in the profile view); Save persists them", () => {
    const { onSaveTargets } = renderModal({
      cvText: "a CV",
      targetRoles: ["Product"],
      targetSectors: ["Fintech"],
    });
    // Target chips are NOT in the profile view anymore — they moved into Settings.
    expect(screen.queryByRole("button", { name: "Product" })).not.toBeInTheDocument();
    // Open Settings → the editable pickers appear with the stored picks pre-selected.
    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    expect(screen.getByText(/Target roles/i)).toBeInTheDocument();
    expect(screen.getByText(/Target industries/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product" }).className).toContain("on");
    expect(screen.getByRole("button", { name: "Fintech" }).className).toContain("on");
    // Save persists the current selection to the profile.
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    expect(onSaveTargets).toHaveBeenCalledTimes(1);
    expect(onSaveTargets).toHaveBeenCalledWith(["Product"], ["Fintech"]);
  });
});
