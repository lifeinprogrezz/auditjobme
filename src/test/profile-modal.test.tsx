// Pins ProfileModal (issue #43 surface, hardened in #54): the avatar's real destination
// for a signed-in user. Three states matter — no CV on file, a CV on file, and the sign-out
// wiring — because a broken empty/loaded branch or a sign-out that doesn't close the modal
// is a dead-end the map shell can't recover from.
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
        {...props}
      />
    </MemoryRouter>,
  );
  return { onClose, onReplaceCv, ...utils };
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
      targetRoles: ["Product Manager"],
      targetSectors: ["Fintech"],
    });
    expect(screen.getByText(/CV on file/i)).toBeInTheDocument();
    expect(screen.getByText(/5 words/i)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded/i)).toHaveTextContent("Jul 2026");
    expect(screen.getByText("Product Manager")).toBeInTheDocument();
    expect(screen.getByText("Fintech")).toBeInTheDocument();
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
});
