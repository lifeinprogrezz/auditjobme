// Pins the CV modal's returning-user shortcut (Rober 7-13): a quiet footer line
// under the drop zone, visible ONLY to an anonymous visitor on a device that has
// held a session before, that fires Google OAuth directly (no CV, no stash).
// New visitors keep the pure CV-first modal; signed-in users never see it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CvUnlockModal from "@/components/roles/CvUnlockModal";
import { markSessionSeen } from "@/lib/deviceSession";

const signInWithOAuth = vi.fn(async () => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } },
}));

function renderModal(props: Partial<React.ComponentProps<typeof CvUnlockModal>> = {}) {
  return render(
    <CvUnlockModal
      open
      onClose={vi.fn()}
      signedIn={false}
      sectorOptions={[]}
      onSubmit={vi.fn(async () => true)}
      {...props}
    />,
  );
}

describe("CvUnlockModal returning-user sign-in line", () => {
  beforeEach(() => {
    localStorage.clear();
    signInWithOAuth.mockClear();
    cleanup();
  });

  it("brand-new device → no sign-in line (pure CV modal)", () => {
    renderModal();
    expect(screen.queryByText(/already have a profile/i)).toBeNull();
  });

  it("device that held a session, anonymous → shows the line", () => {
    markSessionSeen();
    renderModal();
    expect(screen.getByText(/already have a profile/i)).toBeTruthy();
  });

  it("signed in → never shows the line", () => {
    markSessionSeen();
    renderModal({ signedIn: true });
    expect(screen.queryByText(/already have a profile/i)).toBeNull();
  });

  it("click → fires Google OAuth directly, no CV required", () => {
    markSessionSeen();
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth.mock.calls[0][0]).toMatchObject({ provider: "google" });
  });
});
