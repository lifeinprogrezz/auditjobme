// Pins the board-token sync logic (scripts/board-sync-lib.mjs) that keeps
// scripts/boards.json caught up with what the personal career-ops engine has
// already discovered. Pure functions only, no network, no filesystem.
import { describe, expect, it } from "vitest";
import {
  detectBoard,
  teamtailorCandidateHost,
  boardKey,
  indexBoards,
  diffBoards,
  mergeIntoBoards,
  parsePipelineRow,
} from "../../scripts/board-sync-lib.mjs";

describe("detectBoard", () => {
  it("recognises every applicant-tracking system the scraper reads", () => {
    expect(detectBoard("https://job-boards.greenhouse.io/monzo/jobs/7721700")).toEqual({
      ats: "greenhouse",
      token: "monzo",
    });
    expect(detectBoard("https://boards-api.greenhouse.io/v1/boards/vercel/jobs")).toEqual({
      ats: "greenhouse",
      token: "vercel",
    });
    expect(detectBoard("https://jobs.eu.lever.co/spotify/abc-123")).toEqual({
      ats: "lever",
      token: "spotify",
    });
    expect(detectBoard("https://jobs.ashbyhq.com/Perk/9f2")).toEqual({ ats: "ashby", token: "Perk" });
    expect(detectBoard("https://apply.workable.com/exoticca/j/ABC123/")).toEqual({
      ats: "workable",
      token: "exoticca",
    });
    expect(detectBoard("https://jobs.smartrecruiters.com/Wise/744000")).toEqual({
      ats: "smartrecruiters",
      token: "Wise",
    });
    expect(detectBoard("https://73strings.teamtailor.com/jobs/8108490-senior-data-product-manager")).toEqual({
      ats: "teamtailor",
      token: "73strings",
    });
  });

  it("returns null for a posting that is not on a known board", () => {
    expect(detectBoard("https://www.linkedin.com/jobs/view/4442585456")).toBeNull();
    expect(detectBoard("")).toBeNull();
    expect(detectBoard(undefined)).toBeNull();
  });

  it("does not mistake a route segment for a company token", () => {
    expect(detectBoard("https://boards.greenhouse.io/embed/job_board?for=acme")).toBeNull();
  });
});

describe("teamtailorCandidateHost", () => {
  it("spots a Teamtailor career site on a company's own domain", () => {
    // Macadam: nothing in the hostname gives it away, only the posting path does.
    expect(teamtailorCandidateHost("https://careers.macadam.app/jobs/8096943-senior-product-manager")).toBe(
      "careers.macadam.app",
    );
    expect(teamtailorCandidateHost("https://career.anyfin.com/no/jobs/123456-product-manager")).toBe(
      "career.anyfin.com",
    );
  });

  it("leaves the plain teamtailor.com hosts to detectBoard", () => {
    expect(teamtailorCandidateHost("https://iqm.teamtailor.com/jobs/7931336-x")).toBeNull();
  });

  it("ignores paths that only look similar", () => {
    expect(teamtailorCandidateHost("https://example.com/jobs/product-manager")).toBeNull();
    expect(teamtailorCandidateHost("https://example.com/careers/12345-thing")).toBeNull();
  });
});

describe("boardKey + indexBoards", () => {
  it("keys a Teamtailor board by its resolved host, whichever field it uses", () => {
    expect(boardKey("teamtailor", { token: "IQM" })).toBe("iqm.teamtailor.com");
    expect(boardKey("teamtailor", { host: "Careers.Macadam.App" })).toBe("careers.macadam.app");
    expect(boardKey("greenhouse", { token: "Monzo" })).toBe("monzo");
  });

  it("indexes every board list and ignores the _comment field", () => {
    const index = indexBoards({
      _comment: "notes",
      greenhouse: [{ company: "Monzo", token: "monzo" }],
      teamtailor: [{ company: "Macadam", host: "careers.macadam.app" }],
    }) as Record<string, Set<string>>;
    expect(Object.keys(index).sort()).toEqual(["greenhouse", "teamtailor"]);
    expect(index.teamtailor.has("careers.macadam.app")).toBe(true);
  });
});

describe("diffBoards", () => {
  const boards = {
    _comment: "notes",
    greenhouse: [{ company: "Monzo", token: "monzo" }],
    teamtailor: [{ company: "IQM", token: "iqm" }],
  };

  it("returns only what the product does not already know", () => {
    const missing = diffBoards(boards, [
      { ats: "greenhouse", token: "monzo", company: "Monzo" }, // known
      { ats: "greenhouse", token: "vercel", company: "Vercel" }, // new
      { ats: "teamtailor", token: "iqm", company: "IQM" }, // known
      { ats: "teamtailor", host: "careers.macadam.app", company: "Macadam" }, // new
    ]);
    expect(missing.map((m) => m.company)).toEqual(["Vercel", "Macadam"]);
  });

  it("matches known boards case-insensitively", () => {
    expect(diffBoards(boards, [{ ats: "greenhouse", token: "MONZO", company: "Monzo" }])).toEqual([]);
  });

  it("collapses repeats and keeps the first company name it saw", () => {
    const missing = diffBoards(boards, [
      { ats: "greenhouse", token: "vercel", company: null },
      { ats: "greenhouse", token: "vercel", company: "Vercel" },
      { ats: "greenhouse", token: "vercel", company: "Vercel Inc" },
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0].company).toBe("Vercel");
  });

  it("treats an applicant-tracking system the product has never used as all-new", () => {
    const missing = diffBoards({ greenhouse: [] }, [
      { ats: "teamtailor", host: "careers.macadam.app", company: "Macadam" },
    ]);
    expect(missing).toHaveLength(1);
  });
});

describe("mergeIntoBoards", () => {
  const boards = { _comment: "notes", greenhouse: [{ company: "Monzo", token: "monzo" }] };

  it("adds new boards without mutating the input", () => {
    const { boards: next, added } = mergeIntoBoards(boards, [
      { ats: "greenhouse", token: "vercel", company: "Vercel" },
      { ats: "teamtailor", host: "careers.macadam.app", company: "Macadam" },
    ]);
    expect(added).toHaveLength(2);
    expect(next.greenhouse).toHaveLength(2);
    expect(next.teamtailor).toEqual([{ company: "Macadam", host: "careers.macadam.app" }]);
    expect(next._comment).toBe("notes");
    expect(boards.greenhouse).toHaveLength(1); // untouched
  });

  it("is idempotent, which is what makes a monthly run safe", () => {
    const additions = [{ ats: "greenhouse", token: "vercel", company: "Vercel" }];
    const first = mergeIntoBoards(boards, additions);
    const second = mergeIntoBoards(first.boards, additions);
    expect(second.added).toEqual([]);
    expect(second.boards.greenhouse).toHaveLength(2);
  });

  it("falls back to the board key when no company name was resolved", () => {
    const { added } = mergeIntoBoards({}, [{ ats: "greenhouse", token: "acme", company: null }]);
    expect(added[0].company).toBe("acme");
  });
});

describe("parsePipelineRow", () => {
  it("reads the url and company out of an engine pipeline row", () => {
    expect(
      parsePipelineRow(
        "- [ ] [4.8] https://job-boards.greenhouse.io/monzo/jobs/7721700 | Monzo | Product Manager, Business Banking EU | src:ats-direct | posted:2026-06-10",
      ),
    ).toEqual({ url: "https://job-boards.greenhouse.io/monzo/jobs/7721700", company: "Monzo" });
  });

  it("reads a ticked row too", () => {
    expect(
      parsePipelineRow("- [x] [4.2] https://careers.macadam.app/jobs/8096943-x | Macadam | Senior PM |")?.company,
    ).toBe("Macadam");
  });

  it("ignores headings, prose and blank lines", () => {
    expect(parsePipelineRow("## Pendientes")).toBeNull();
    expect(parsePipelineRow("")).toBeNull();
    expect(parsePipelineRow("- [ ] no url here | Monzo |")).toBeNull();
  });
});
