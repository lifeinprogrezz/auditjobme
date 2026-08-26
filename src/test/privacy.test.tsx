// Pins the Privacy page's erasure list (issue #156): the 19-bullet "what deletion
// destroys" list moved off /settings onto here, under the rights section. It has
// to render every USER_DATA_TABLES label, generated straight from the same list
// the account export reads, so this page can never quietly drift from the code.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Privacy from "@/pages/Privacy";
import { USER_DATA_TABLES } from "@/lib/account";

function renderPrivacy() {
  return render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  );
}

describe("Privacy — erasure list (issue #156)", () => {
  afterEach(cleanup);

  it("renders every USER_DATA_TABLES label, so the erasure promise can't drift from the code", () => {
    renderPrivacy();
    for (const spec of USER_DATA_TABLES) {
      expect(screen.getByText(spec.label)).toBeInTheDocument();
    }
  });

  // The list is keyed per ENTRY, not per table: referrals appears twice, once per
  // user column. Keyed by table alone it repeats a key, which React reports as a
  // console error and which lets one line be dropped or reordered (moved here from
  // settings-panel.test.tsx along with the list itself).
  it("keys the list per entry, so a table listed twice never repeats a key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPrivacy();
    const duplicateKeyWarnings = errors.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && /same key/i.test(a)),
    );
    expect(duplicateKeyWarnings).toEqual([]);
    errors.mockRestore();
  });
});
