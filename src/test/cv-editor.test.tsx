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

/** Two jobs, so "the entry above" and the ordering controls have something to act on. */
const CV_TWO: CvStructured = {
  ...CV,
  experience: [
    { company: "Acme Corp", role: "Product Manager", start: "09/2021", end: "Present", bullets: ["Grew activation 40%"] },
    { company: "Northgoing", role: "Founder", start: "2025", end: "", bullets: ["Built the scoring engine"] },
  ],
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

// The owner-only half (#150 follow-up): the parse mirrors the CV, and these controls
// are where the person who wrote it says what the parse cannot know.
describe("CvEditor — order and grouping", () => {
  /** Open the Experience fold and hand back what Save would write. */
  const openExperience = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /^Experience/i }));
  };
  const saved = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(saveCvStructured).toHaveBeenCalled());
    return saveCvStructured.mock.calls.at(-1)?.[1] as CvStructured;
  };

  beforeEach(() => {
    cleanup();
    ensureCvStructured.mockReset().mockResolvedValue(structuredClone(CV_TWO));
    parseAndSaveCv.mockReset().mockResolvedValue(structuredClone(CV_TWO));
    saveCvStructured.mockReset().mockResolvedValue(true);
  });

  it("Move up swaps an entry with the one above it", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    fireEvent.click(screen.getByRole("button", { name: /Move Northgoing up/i }));
    expect((await saved()).experience.map((e) => e.company)).toEqual(["Northgoing", "Acme Corp"]);
  });

  it("Move down swaps an entry with the one below it", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    fireEvent.click(screen.getByRole("button", { name: /Move Acme Corp down/i }));
    expect((await saved()).experience.map((e) => e.company)).toEqual(["Northgoing", "Acme Corp"]);
  });

  it("the ends of the list have nowhere to go, so those controls are off", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    expect(screen.getByRole("button", { name: /Move Acme Corp up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Northgoing down/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Acme Corp down/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Move Northgoing up/i })).toBeEnabled();
  });

  it("Remove drops the entry with no dialog in the way, and Save writes what is left", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    fireEvent.click(screen.getByRole("button", { name: /Remove Acme Corp/i }));
    await waitFor(() => expect(screen.queryByDisplayValue("Acme Corp")).not.toBeInTheDocument());
    expect((await saved()).experience.map((e) => e.company)).toEqual(["Northgoing"]);
  });

  it("the section says a removal is not final, because 'Read my CV again' undoes it", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    expect(screen.getByText(/Read my CV again" brings the whole thing back/i)).toBeInTheDocument();
  });

  it("the tick box marks an entry as part of the one above, and that is what Save writes", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    const box = screen.getByLabelText(/Show Northgoing as part of the entry above/i);
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    const written = await saved();
    expect(written.experience[1].groupedIntoPrevious).toBe(true);
    // The bullets themselves are untouched: grouping moves where they print, nothing else.
    expect(written.experience[1].bullets).toEqual(["Built the scoring engine"]);
    expect(written.experience[0].groupedIntoPrevious).toBeUndefined();
  });

  it("unticking it puts the entry back on its own, with no flag left behind", async () => {
    const flagged = structuredClone(CV_TWO);
    flagged.experience[1].groupedIntoPrevious = true;
    ensureCvStructured.mockResolvedValue(flagged);
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    const box = screen.getByLabelText(/Show Northgoing as part of the entry above/i);
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect((await saved()).experience[1].groupedIntoPrevious).toBeUndefined();
  });

  it("the first entry cannot be grouped, and says why", async () => {
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    expect(screen.getByLabelText(/Show Acme Corp as part of the entry above/i)).toBeDisabled();
    expect(screen.getByText(/nothing above it to join/i)).toBeInTheDocument();
  });

  it("a flag that ends up on the first entry is dropped when the order changes", async () => {
    const flagged = structuredClone(CV_TWO);
    flagged.experience[1].groupedIntoPrevious = true;
    ensureCvStructured.mockResolvedValue(flagged);
    render(<CvEditor userId="u1" cvText="some cv text" />);
    await openExperience();
    fireEvent.click(screen.getByRole("button", { name: /Move Northgoing up/i }));
    const written = await saved();
    expect(written.experience[0].company).toBe("Northgoing");
    expect(written.experience[0].groupedIntoPrevious).toBeUndefined();
  });
});
