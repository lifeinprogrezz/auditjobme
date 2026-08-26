// Pins logo-domain derivation (scripts/logo-lib.mjs), issue #68 item 4.
// Contract: derive ONLY from URLs the company owns (careers_url, then website);
// hosted-ATS/platform hosts yield null — a wrong domain renders a WRONG logo.
import { describe, expect, it } from "vitest";
import { deriveLogoDomain, domainFromUrl, resolveLogoDomain, partitionAggregatorDomains } from "../../scripts/logo-lib.mjs";

describe("domainFromUrl", () => {
  it("derives the Macadam class: careers.macadam.app -> macadam.app", () => {
    expect(domainFromUrl("https://careers.macadam.app")).toBe("macadam.app");
    expect(domainFromUrl("https://careers.macadam.app/jobs/pm")).toBe("macadam.app");
  });

  it("strips a single leading careers-ish label (www/jobs/apply)", () => {
    expect(domainFromUrl("https://www.acme.com/")).toBe("acme.com");
    expect(domainFromUrl("https://jobs.acme.co.uk/vacancies")).toBe("acme.co.uk");
    expect(domainFromUrl("https://apply.acme.io")).toBe("acme.io");
  });

  it("leaves a bare two-label domain alone", () => {
    expect(domainFromUrl("https://macadam.app")).toBe("macadam.app");
  });

  it("hosted-ATS / platform hosts are NEVER a company domain", () => {
    expect(domainFromUrl("https://macadam.teamtailor.com")).toBeNull();
    expect(domainFromUrl("https://boards.greenhouse.io/acme")).toBeNull();
    expect(domainFromUrl("https://jobs.lever.co/acme")).toBeNull();
    expect(domainFromUrl("https://jobs.ashbyhq.com/acme")).toBeNull();
    expect(domainFromUrl("https://apply.workable.com/acme")).toBeNull();
    expect(domainFromUrl("https://acme.jobs.personio.de")).toBeNull();
    expect(domainFromUrl("https://www.linkedin.com/company/acme")).toBeNull();
    expect(domainFromUrl("https://acme.notion.site/careers")).toBeNull();
  });

  it("tolerates scheme-less values and rejects garbage", () => {
    expect(domainFromUrl("careers.macadam.app")).toBe("macadam.app");
    expect(domainFromUrl("")).toBeNull();
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl("localhost")).toBeNull();
  });

  it("job-board / aggregator hosts are NEVER a company domain (issue #153 fix round 1: measured on prod, 43+ wrong logo/website guesses via these hosts)", () => {
    expect(domainFromUrl("https://www.welcometothejungle.com/en/companies/acme/jobs/pm")).toBeNull();
    expect(domainFromUrl("https://www.ycombinator.com/companies/acme/jobs/1")).toBeNull();
    expect(domainFromUrl("https://www.workatastartup.com/jobs/1")).toBeNull();
    expect(domainFromUrl("https://jobs.gem.com/acme/1")).toBeNull();
    expect(domainFromUrl("https://app.dover.com/apply/acme/1")).toBeNull();
    expect(domainFromUrl("https://wellfound.com/jobs/1")).toBeNull();
    expect(domainFromUrl("https://app.thehub.io/jobs/1")).toBeNull();
    expect(domainFromUrl("https://employmenthero.com/jobs/1")).toBeNull();
    expect(domainFromUrl("https://app.screenloop.com/acme/jobs/1")).toBeNull();
    expect(domainFromUrl("https://ats.rippling.com/acme/jobs/1")).toBeNull();
    expect(domainFromUrl("https://hibob.com/careers/1")).toBeNull();
    expect(domainFromUrl("https://comeet.com/jobs/acme/1")).toBeNull();
    expect(domainFromUrl("https://acme.myworkdaysite.com/en-US/careers/job/1")).toBeNull();
  });

  it("more ATS/HR-platform hosts are NEVER a company domain (issue #153 fix round 2, blocker 3: measured on the 852 unlinked companies)", () => {
    expect(domainFromUrl("https://emp.jobylon.com/acme/jobs/1")).toBeNull(); // Furhat
    expect(domainFromUrl("https://revolutpeople.com/careers/1")).toBeNull(); // Terra API
    expect(domainFromUrl("https://taleez.com/offre/1/acme")).toBeNull(); // Enchanted Tools
    expect(domainFromUrl("https://builtin.com/company/acme/jobs/1")).toBeNull(); // FindMeCure
    expect(domainFromUrl("https://wandercraft.welcomekit.co/jobs/1")).toBeNull();
    expect(domainFromUrl("https://corma.welcomekit.co/jobs/1")).toBeNull();
    expect(domainFromUrl("https://flynt.welcomekit.co/jobs/1")).toBeNull();
    expect(domainFromUrl("https://worldfavor.careers.haileyhr.app/jobs/1")).toBeNull();
    expect(domainFromUrl("https://unboxrobotics.keka.com/careers/1")).toBeNull();
    expect(domainFromUrl("https://remuner.viterbit.site/es/oferta/1")).toBeNull();
    expect(domainFromUrl("https://wonka-ai.odoo.com/jobs/1")).toBeNull();
  });

  it("strips a singular 'career' label and the Spanish/generic variants, not just the plural (issue #153 fix round 2, blocker 3: 17 companies kept the careers page as their website)", () => {
    expect(domainFromUrl("https://career.mynt.com/jobs/1")).toBe("mynt.com");
    expect(domainFromUrl("https://career.flinn.com")).toBe("flinn.com");
    expect(domainFromUrl("https://talento.acme.com/ofertas")).toBe("acme.com");
    expect(domainFromUrl("https://empleo.acme.es/vacantes")).toBe("acme.es");
    expect(domainFromUrl("https://about.acme.com/careers")).toBe("acme.com");
    expect(domainFromUrl("https://corporate.acme.com/jobs")).toBe("acme.com");
  });
});

describe("deriveLogoDomain", () => {
  it("careers URL wins over website", () => {
    expect(deriveLogoDomain({ careersUrl: "https://careers.macadam.app", website: "https://other.com" })).toBe(
      "macadam.app",
    );
  });

  it("falls back to website when the careers URL is hosted-ATS", () => {
    expect(deriveLogoDomain({ careersUrl: "https://macadam.teamtailor.com", website: "https://macadam.app" })).toBe(
      "macadam.app",
    );
  });

  it("returns null (never guesses) when neither URL is usable", () => {
    expect(deriveLogoDomain({ careersUrl: "https://boards.greenhouse.io/x", website: null })).toBeNull();
    expect(deriveLogoDomain({})).toBeNull();
  });
});

describe("resolveLogoDomain — the full fallback order (issue #153 item B1)", () => {
  it("careers_url/website still wins, unchanged, and never touches applyUrls", () => {
    expect(
      resolveLogoDomain({
        careersUrl: "https://careers.macadam.app",
        website: null,
        applyUrls: ["https://boards.greenhouse.io/wrong/jobs/1"],
      }),
    ).toEqual({ domain: "macadam.app", derivedWebsite: null });
  });

  it("a company with NEITHER careers_url nor website falls to its own apply-URL host", () => {
    expect(
      resolveLogoDomain({
        careersUrl: null,
        website: null,
        applyUrls: ["https://boards.greenhouse.io/acme/jobs/1", "https://acme.io/careers/pm"],
      }),
    ).toEqual({ domain: "acme.io", derivedWebsite: "https://acme.io" });
  });

  it("hosted-ATS apply URLs never resolve — the wrong domain is worse than none", () => {
    expect(
      resolveLogoDomain({
        careersUrl: null,
        website: null,
        applyUrls: ["https://jobs.lever.co/acme/1", "https://www.linkedin.com/jobs/view/1"],
      }),
    ).toEqual({ domain: null, derivedWebsite: null });
  });

  it("a website on file that just didn't resolve is never overridden by an apply-URL guess", () => {
    expect(
      resolveLogoDomain({
        careersUrl: null,
        website: "https://boards.greenhouse.io/not-a-real-site", // deliberately unresolvable
        applyUrls: ["https://acme.io/careers/pm"],
      }),
    ).toEqual({ domain: null, derivedWebsite: null });
  });

  it("no applyUrls at all is the same as none resolving", () => {
    expect(resolveLogoDomain({ careersUrl: null, website: null, applyUrls: [] })).toEqual({
      domain: null,
      derivedWebsite: null,
    });
    expect(resolveLogoDomain({})).toEqual({ domain: null, derivedWebsite: null });
  });
});

describe("partitionAggregatorDomains — data-driven guard (issue #153 fix round 1, blocker 1)", () => {
  it("leaves every fill alone when no domain repeats", () => {
    const fills = [
      { slug: "acme", name: "Acme", domain: "acme.io", website: "https://acme.io" },
      { slug: "beta", name: "Beta", domain: "beta.io", website: "https://beta.io" },
    ];
    const { safe, skipped, aggregatorDomains } = partitionAggregatorDomains(fills);
    expect(safe).toEqual(fills);
    expect(skipped).toEqual([]);
    expect(aggregatorDomains.size).toBe(0);
  });

  it("excludes a domain shared by >=3 companies -- an aggregator that slipped past the static host list", () => {
    const fills = [
      { slug: "a", name: "A", domain: "welcometothejungle.com", website: "https://welcometothejungle.com" },
      { slug: "b", name: "B", domain: "welcometothejungle.com", website: "https://welcometothejungle.com" },
      { slug: "c", name: "C", domain: "welcometothejungle.com", website: "https://welcometothejungle.com" },
      { slug: "d", name: "D", domain: "acme.io", website: "https://acme.io" },
    ];
    const { safe, skipped, aggregatorDomains } = partitionAggregatorDomains(fills);
    expect(safe).toEqual([fills[3]]);
    expect(skipped).toEqual([fills[0], fills[1], fills[2]]);
    expect(aggregatorDomains).toEqual(new Set(["welcometothejungle.com"]));
  });

  it("2 companies sharing a domain stays under the default threshold and is not flagged", () => {
    const fills = [
      { slug: "a", name: "A", domain: "shared.io", website: "https://shared.io" },
      { slug: "b", name: "B", domain: "shared.io", website: "https://shared.io" },
    ];
    const { safe, skipped } = partitionAggregatorDomains(fills);
    expect(safe).toEqual(fills);
    expect(skipped).toEqual([]);
  });

  it("minCompanies is configurable", () => {
    const fills = [
      { slug: "a", name: "A", domain: "shared.io", website: "https://shared.io" },
      { slug: "b", name: "B", domain: "shared.io", website: "https://shared.io" },
    ];
    const { safe, skipped } = partitionAggregatorDomains(fills, 2);
    expect(safe).toEqual([]);
    expect(skipped).toEqual(fills);
  });

  it("is a no-op on an empty fills list", () => {
    expect(partitionAggregatorDomains([])).toEqual({ safe: [], skipped: [], aggregatorDomains: new Set() });
  });

  it("catches an aggregator that hands each company its OWN subdomain, not just a shared exact host (issue #153 fix round 2, blocker 3: welcomekit.co)", () => {
    // The bug this pins: wandercraft/corma/flynt each resolved a DIFFERENT
    // full host, so counting by f.domain never saw the same string 3 times
    // and the >=3 guard never fired -- even though all three sit on the same
    // multi-tenant welcomekit.co platform.
    const fills = [
      { slug: "wandercraft", name: "Wandercraft", domain: "wandercraft.welcomekit.co", website: "https://wandercraft.welcomekit.co" },
      { slug: "corma", name: "Corma", domain: "corma.welcomekit.co", website: "https://corma.welcomekit.co" },
      { slug: "flynt", name: "Flynt", domain: "flynt.welcomekit.co", website: "https://flynt.welcomekit.co" },
      { slug: "acme", name: "Acme", domain: "acme.io", website: "https://acme.io" },
    ];
    const { safe, skipped, aggregatorDomains } = partitionAggregatorDomains(fills);
    expect(safe).toEqual([fills[3]]);
    expect(skipped).toEqual([fills[0], fills[1], fills[2]]);
    expect(aggregatorDomains).toEqual(new Set(["welcomekit.co"]));
  });

  it("does not merge distinct companies on a second-level ccTLD (acme.co.uk) into a false aggregator bucket", () => {
    // registrableDomain's last-two-labels heuristic would wrongly read "co.uk"
    // as the shared base for every .co.uk domain without this exception.
    const fills = [
      { slug: "a", name: "A", domain: "a.co.uk", website: "https://a.co.uk" },
      { slug: "b", name: "B", domain: "b.co.uk", website: "https://b.co.uk" },
      { slug: "c", name: "C", domain: "c.co.uk", website: "https://c.co.uk" },
    ];
    const { safe, skipped } = partitionAggregatorDomains(fills);
    expect(safe).toEqual(fills);
    expect(skipped).toEqual([]);
  });
});
