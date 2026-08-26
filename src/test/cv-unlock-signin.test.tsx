// Pins the CV modal's returning-user shortcut (Rober 7-13, widened issue #158
// / A1): a quiet footer line under the drop zone that fires Google OAuth
// directly (no CV, no stash). Used to show only on a device that had held a
// session before (hasSeenSession) — that hid it from every brand-new visitor,
// which is most of them, and a first-time run on stranger-run feedback caught
// it. Now shown to any signed-out visitor; signed-in users never see it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CvUnlockModal from "@/components/roles/CvUnlockModal";

const signInWithOAuth = vi.fn(async (..._a: unknown[]) => ({ error: null }));
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

  it("brand-new device, anonymous → still shows the line (issue #158 / A1)", () => {
    renderModal();
    expect(screen.getByText(/already have a profile/i)).toBeTruthy();
  });

  it("signed in → never shows the line", () => {
    renderModal({ signedIn: true });
    expect(screen.queryByText(/already have a profile/i)).toBeNull();
  });

  it("click → fires Google OAuth directly, no CV required", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth.mock.calls[0][0]).toMatchObject({ provider: "google" });
  });
});
