import { describe, expect, it } from "vitest";
import { countryInLocation, countriesInLocation, fallbackCity, CITY_COUNTRY, CITY_COORDS, cityOf } from "@/lib/geo";

// The map placed 6,906 of 8,189 roles (84.3%). The missing 1,283 name a COUNTRY or
// a region rather than a city — "United Kingdom", "Germany", "Europe",
// "Remote - United Kingdom" — so cityOf returned null and they never got a pin,
// while still being counted in the header and listed in the panel.
//
// They are placed at the company's OWN office instead. The country condition is
// the whole safety of that: measured over the live dataplane, placing them without
// it puts 361 roles in the wrong country. Every "returns null" case below is a
// role that stays off the map ON PURPOSE.
describe("countryInLocation", () => {
  it("reads a bare country name", () => {
    expect(countryInLocation("Germany")).toBe("Germany");
    expect(countryInLocation("Spain")).toBe("Spain");
  });

  it("reads a country out of the remote phrasings the boards actually use", () => {
    for (const s of ["Remote - United Kingdom", "United Kingdom (Remote)", "Remote, United Kingdom"]) {
      expect(countryInLocation(s)).toBe("United Kingdom");
    }
    expect(countryInLocation("Spain (Remote)")).toBe("Spain");
  });

  it("resolves the aliases a job board writes instead of the canonical name", () => {
    expect(countryInLocation("London, UK")).toBe("United Kingdom");
    expect(countryInLocation("England")).toBe("United Kingdom");
    expect(countryInLocation("Deutschland")).toBe("Germany");
    expect(countryInLocation("Holland")).toBe("Netherlands");
  });

  it("names no country for a region, a city alone, or nothing", () => {
    for (const s of ["Europe", "EMEA - Remote", "Remote", "Berlin", "", null]) {
      expect(countryInLocation(s)).toBeNull();
    }
  });
});

describe("fallbackCity", () => {
  it("places a country-only role at the company's office IN THAT COUNTRY", () => {
    expect(fallbackCity("United Kingdom", ["London"])).toBe("London");
    expect(fallbackCity("Germany", ["Berlin"])).toBe("Berlin");
    expect(fallbackCity("Remote - Ireland", ["Dublin"])).toBe("Dublin");
  });

  it("picks the right office when the company has several countries", () => {
    const offices = ["Berlin", "London", "Paris"];
    expect(fallbackCity("United Kingdom", offices)).toBe("London");
    expect(fallbackCity("Germany", offices)).toBe("Berlin");
  });

  // THE ONE THAT MATTERS. 361 roles measured.
  it("REFUSES when the only office is in a different country (mutant: drop the country check)", () => {
    expect(fallbackCity("United Kingdom", ["Berlin"])).toBeNull();
    expect(fallbackCity("Spain", ["London", "Paris"])).toBeNull();
    expect(fallbackCity("Poland", ["Amsterdam"])).toBeNull();
  });

  it("refuses when the named country holds two of the company's offices, since which one is a guess", () => {
    expect(fallbackCity("Germany", ["Berlin", "Munich"])).toBeNull();
  });

  it("uses the single office when the role names no country at all", () => {
    expect(fallbackCity("Europe", ["Amsterdam"])).toBe("Amsterdam");
    expect(fallbackCity("", ["Stockholm"])).toBe("Stockholm");
    expect(fallbackCity(null, ["Lisbon"])).toBe("Lisbon");
  });

  it("refuses a no-country role when the company has several offices", () => {
    expect(fallbackCity("Europe", ["Amsterdam", "Berlin"])).toBeNull();
    expect(fallbackCity("EMEA - Remote", ["London", "Dublin"])).toBeNull();
  });

  it("returns null with no offices at all — nothing is ever invented", () => {
    expect(fallbackCity("Germany", [])).toBeNull();
    expect(fallbackCity("Europe", [])).toBeNull();
  });

  it("canonicalises the office city before matching, so raw board spellings work", () => {
    expect(fallbackCity("Germany", ["München"])).toBe("Munich");
    expect(fallbackCity("United Kingdom", ["London, United Kingdom"])).toBe("London");
  });
});

describe("CITY_COUNTRY stays aligned with CITY_COORDS", () => {
  it("every city with a country also has coordinates, or the fallback points nowhere", () => {
    for (const city of Object.keys(CITY_COUNTRY)) {
      expect(CITY_COORDS[city], `${city} has a country but no coordinates`).toBeDefined();
    }
  });

  it("every canonical city carries a country, or it can never satisfy a country match", () => {
    for (const city of Object.keys(CITY_COORDS)) {
      expect(CITY_COUNTRY[city], `${city} has coordinates but no country`).toBeDefined();
    }
  });

  it("cityOf agrees that each key is already canonical", () => {
    for (const city of Object.keys(CITY_COUNTRY)) expect(cityOf(city)).toBe(city);
  });
});

// Boards post one role across a list of countries. Taking only the leading match
// would pick one of them arbitrarily; the rule is the same as everywhere else here
// — place it when exactly one of the company's offices is in ANY named country,
// refuse when several are.
describe("locations that name several countries", () => {
  it("reads all of them, in the order written", () => {
    expect(countriesInLocation("Belgium; Dubai; Portugal; United Kingdom; United States"))
      .toEqual(["Belgium", "Portugal", "United Kingdom"]);
  });

  it("does not double-count an alias sitting inside a longer name", () => {
    expect(countriesInLocation("London, United Kingdom, UK")).toEqual(["United Kingdom"]);
  });

  it("places the role when exactly one office is in any of the named countries", () => {
    expect(fallbackCity("Belgium; Portugal; United Kingdom", ["London"])).toBe("London");
  });

  it("refuses when the company has an office in two of the named countries", () => {
    expect(fallbackCity("Belgium; United Kingdom", ["London", "Brussels"])).toBeNull();
  });
});
