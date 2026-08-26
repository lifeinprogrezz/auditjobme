// Pins CvEditor — the "what we read from your CV" panel inside Settings (issue #150).
// What matters: the structure a person sees is the one that will print, an edit
// survives a Save, "Read my CV again" replaces it with a fresh parse, and a profile
// with no CV shows nothing at all rather than an empty form.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import CvEditor from "@/components/app/CvEditor";
import type { CvStructured } from "@/lib/cvStructured";

const ensureCvStructured = vi.fn();
const parseAndSaveCv = vi.fn();
const saveCvStructured = vi.fn();

vi.mock("@/lib/cvParse", () => ({
  ensureCvStructured: (...args: unknown[]) => ensureCvStructured(...args),
  parseAndSaveCv: (...args: unknown[]) => parseAndSaveCv(...args),
  saveCvStructured: (...args: unknown[]) => saveCvStructured(...args),
}));

const CV: CvStructured = {
  contact: { name: "Jane Doe", email: "jane@example.com", location: "Barcelona, Spain", links: [] },
  summary: "",
  experience: [
    {
      company: "Acme Corp",
      role: "Product Manager",
      start: "09/2021",
      end: "Present",
      bullets: ["Grew activation 40%"],
    },
  ],
  education: [],
  skills: [],
  extras: [],
};

describe("CvEditor", () => {
  beforeEach(() => {
    cleanup();
    ensureCvStructured.mockReset().mockResolvedValue(structuredClone(CV));
    parseAndSaveCv.mockReset().mockResolvedValue(structuredClone(CV));
    saveCvStructured.mockReset().mockResolvedValue(true);
  });

  it("renders nothing when there is no CV to read", () => {
    const { container } = render(<CvEditor userId="u1" cvText={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(ensureCvStructured).not.toHaveBeenCalled();
  });

  it("shows what was read, and says the fields are the person's own words", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    expect(await screen.findByDisplayValue("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText(/word for word/i)).toBeInTheDocument();
    expect(ensureCvStructured).toHaveBeenCalledWith("u1", "some cv text");
  });

  it("an edited field is what Save writes", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    const name = await screen.findByDisplayValue("Jane Doe");
    fireEvent.change(name, { target: { value: "Jane R. Doe" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(saveCvStructured).toHaveBeenCalledTimes(1));
    const written = saveCvStructured.mock.calls[0][1] as CvStructured;
    expect(written.contact.name).toBe("Jane R. Doe");
    expect(written.experience[0].bullets).toEqual(["Grew activation 40%"]);
    expect(await screen.findByText(/Saved\./i)).toBeInTheDocument();
  });

  it("a failed save says so, and keeps the edit on screen", async () => {
    saveCvStructured.mockResolvedValue(false);
    render(<CvEditor userId="u1" cvText="some cv text" />);
    const name = await screen.findByDisplayValue("Jane Doe");
    fireEvent.change(name, { target: { value: "Jane R. Doe" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jane R. Doe")).toBeInTheDocument();
  });

  it("bullets can be added and removed, one job at a time", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Experience/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add a bullet/i }));
    const bullets = () => screen.getAllByLabelText(/^Bullet \d+ at Acme Corp$/i);
    await waitFor(() => expect(bullets()).toHaveLength(2));
    fireEvent.change(bullets()[1], { target: { value: "Led a team of 5" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(saveCvStructured).toHaveBeenCalled());
    expect((saveCvStructured.mock.calls[0][1] as CvStructured).experience[0].bullets).toEqual([
      "Grew activation 40%",
      "Led a team of 5",
    ]);
  });

  it("'Read my CV again' re-runs the one parse and shows what came back", async () => {
    const reparsed = structuredClone(CV);
    reparsed.contact.name = "Jane Doe (re-read)";
    parseAndSaveCv.mockResolvedValue(reparsed);
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await screen.findByDisplayValue("Jane Doe");
    fireEvent.click(screen.getByRole("button", { name: /Read my CV again/i }));
    expect(await screen.findByDisplayValue("Jane Doe (re-read)")).toBeInTheDocument();
    expect(parseAndSaveCv).toHaveBeenCalledWith("u1", "some cv text");
  });

  it("an unparsed profile offers the read instead of an empty form", async () => {
    ensureCvStructured.mockResolvedValue(null);
    render(<CvEditor userId="u1" cvText="some cv text" />);
    expect(await screen.findByText(/prints as plain text for now/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save changes/i })).not.toBeInTheDocument();
  });
});
