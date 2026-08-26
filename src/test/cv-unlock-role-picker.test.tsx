// Pins the onboarding role picker's parity with the map's Role filter (issue
// #158 / A4): onboarding used to offer only the five families, one short of
// the map filter's five-plus-Other — a user whose CV didn't fit any family had
// no way to say so at sign-up, even though the map itself has an answer for
// exactly that case.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import CvUnlockModal from "@/components/roles/CvUnlockModal";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOAuth: vi.fn(async () => ({ error: null })) } },
}));
vi.mock("@/lib/pdfText", () => ({
  extractPdfText: vi.fn(async () => "Some parsed CV text with enough words to count."),
}));

function renderModal() {
  return render(
    <CvUnlockModal
      open
      onClose={vi.fn()}
      signedIn={false}
      sectorOptions={[]}
      onSubmit={vi.fn(async () => true)}
    />,
  );
}

async function uploadCv() {
  const file = new File(["%PDF-1.4 fake"], "cv.pdf", { type: "application/pdf" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Product Manager" })).toBeInTheDocument());
}

describe("CvUnlockModal role picker — parity with the map's Role filter (issue #158 / A4)", () => {
  afterEach(cleanup);

  it("offers the five families plus Other, matching the map filter exactly", async () => {
    renderModal();
    await uploadCv();
    for (const label of ["Product Manager", "Engineering", "Sales", "Marketing", "Operations", "Other"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("Other counts toward the same ROLE_CAP as any other pick", async () => {
    renderModal();
    await uploadCv();
    fireEvent.click(screen.getByRole("button", { name: "Product Manager" }));
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    // ROLE_CAP is 2 (issue #156): a third pick is disabled, not silently ignored.
    expect(screen.getByRole("button", { name: "Engineering" })).toBeDisabled();
  });

  it("caption states the industries picker's liquidity gate", async () => {
    renderModal();
    await uploadCv();
    expect(
      screen.getByText("Showing the 12 industries with the most open roles."),
    ).toBeInTheDocument();
  });
});
