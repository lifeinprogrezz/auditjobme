// Pins the pure geocoding helpers (scripts/geocode-lib.mjs), issue #153 item
// B2: distance/precision math, request URLs, and response parsing for both
// providers, plus the migration-absent degrade path. Same pattern as
// src/test/logo-lib.test.ts — a vitest wrapper around a scripts/*.mjs module.
import { describe, expect, it } from "vitest";
import {
  haversineKm,
  MAX_OFFICE_TO_CITY_KM,
  cityKeyFor,
  nominatimSearchUrl,
  parseNominatimResult,
  mapboxSearchUrl,
  parseMapboxResult,
  waitMsFor,
  MIN_REQUEST_INTERVAL_MS,
  isMissingTableError,
  officeKey,
  shouldSkipExistingOffice,
  isTrustworthyOffice,
} from "../../scripts/geocode-lib.mjs";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm([2.17, 41.39], [2.17, 41.39])).toBeCloseTo(0, 6);
  });

  it("matches the known Barcelona-Madrid distance (~504km)", () => {
    expect(haversineKm([2.17, 41.39], [-3.7, 40.42])).toBeCloseTo(504, -1);
  });

  it("a 50km cap accepts a nearby office and rejects a wrong-city one", () => {
    // ~7km apart within Barcelona -- inside the cap.
    expect(haversineKm([2.17, 41.39], [2.15, 41.42])).toBeLessThan(MAX_OFFICE_TO_CITY_KM);
    // Barcelona vs Madrid -- well outside the cap.
    expect(haversineKm([2.17, 41.39], [-3.7, 40.42])).toBeGreaterThan(MAX_OFFICE_TO_CITY_KM);
  });
});

describe("cityKeyFor", () => {
  it("lowercases and folds diacritics, matching the live table's style", () => {
    expect(cityKeyFor("London")).toBe("london");
    expect(cityKeyFor("Kobenhavn")).toBe("kobenhavn");
    expect(cityKeyFor("München")).toBe("munchen");
  });

  it("keeps spaces (unlike companies.slug) and collapses repeats", () => {
    expect(cityKeyFor("Novi   Sad")).toBe("novi sad");
    expect(cityKeyFor("  Berlin  ")).toBe("berlin");
  });

  it("is empty for a missing city", () => {
    expect(cityKeyFor(null)).toBe("");
    expect(cityKeyFor(undefined)).toBe("");
  });
});

describe("nominatimSearchUrl", () => {
  it("builds a jsonv2 + addressdetails request for the exact query text", () => {
    const url = nominatimSearchUrl("Acme, Berlin, Germany");
    expect(url.startsWith("https://nominatim.openstreetmap.org/search?")).toBe(true);
    expect(url).toContain("q=Acme%2C+Berlin%2C+Germany");
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("addressdetails=1");
    expect(url).toContain("limit=1");
  });
});

describe("parseNominatimResult", () => {
  it("parses a real-shaped street-level result (Nominatim /search fixture)", () => {
    const fixture = [
      {
        lat: "52.5024047",
        lon: "13.4120778",
        display_name: "Acme GmbH, Prinzessinnenstrasse, Kreuzberg, Berlin, Germany",
        address: {
          road: "Prinzessinnenstrasse",
          house_number: "19",
          suburb: "Kreuzberg",
          city: "Berlin",
          country: "Germany",
        },
      },
    ];
    expect(parseNominatimResult(fixture)).toEqual({
      lat: 52.5024047,
      lng: 13.4120778,
      displayName: "Acme GmbH, Prinzessinnenstrasse, Kreuzberg, Berlin, Germany",
      city: "Berlin",
      precision: "street",
      name: null,
      class: null,
    });
  });

  it("falls back through town/village/municipality/county for the city field", () => {
    const withTown = [{ lat: "1", lon: "2", address: { town: "Didcot" } }];
    expect(parseNominatimResult(withTown)?.city).toBe("Didcot");
    const withVillage = [{ lat: "1", lon: "2", address: { village: "Meyreuil" } }];
    expect(parseNominatimResult(withVillage)?.city).toBe("Meyreuil");
  });

  it("marks a result with no road/house_number as locality precision, not street", () => {
    const fixture = [{ lat: "48.14", lon: "11.58", address: { city: "Munich", country: "Germany" } }];
    expect(parseNominatimResult(fixture)?.precision).toBe("locality");
  });

  it("marks a result with no city breakdown at all as approximate", () => {
    const fixture = [{ lat: "48.14", lon: "11.58", address: { country: "Germany" } }];
    expect(parseNominatimResult(fixture)).toEqual({
      lat: 48.14,
      lng: 11.58,
      displayName: null,
      city: null,
      precision: "approximate",
      name: null,
      class: null,
    });
  });

  it("returns null for an empty result set (a legitimate 'nothing found')", () => {
    expect(parseNominatimResult([])).toBeNull();
    expect(parseNominatimResult(null)).toBeNull();
  });

  it("returns null for a malformed lat/lon", () => {
    expect(parseNominatimResult([{ lat: "not-a-number", lon: "13" }])).toBeNull();
  });
});

describe("mapboxSearchUrl", () => {
  it("URL-encodes the query and carries the token", () => {
    const url = mapboxSearchUrl("Acme, Berlin", "pk.test123");
    expect(url).toBe(
      "https://api.mapbox.com/geocoding/v5/mapbox.places/Acme%2C%20Berlin.json?access_token=pk.test123&limit=1",
    );
  });
});

describe("parseMapboxResult", () => {
  it("parses a real-shaped Mapbox Geocoding v5 fixture", () => {
    const fixture = {
      features: [
        {
          place_name: "Acme, Prinzessinnenstrasse 19, 10969 Berlin, Germany",
          center: [13.4120778, 52.5024047],
          place_type: ["address"],
          context: [{ id: "place.123", text: "Berlin" }, { id: "country.1", text: "Germany" }],
        },
      ],
    };
    expect(parseMapboxResult(fixture)).toEqual({
      lat: 52.5024047,
      lng: 13.4120778,
      displayName: "Acme, Prinzessinnenstrasse 19, 10969 Berlin, Germany",
      city: "Berlin",
      precision: "street",
      name: null,
      class: "address",
    });
  });

  it("reads the city name straight off a place-type feature (the centroid query)", () => {
    const fixture = { features: [{ place_name: "Berlin, Germany", center: [13.4, 52.52], place_type: ["place"], text: "Berlin" }] };
    expect(parseMapboxResult(fixture)).toEqual({
      lat: 52.52,
      lng: 13.4,
      displayName: "Berlin, Germany",
      city: "Berlin",
      precision: "locality",
      name: "Berlin",
      class: "place",
    });
  });

  it("returns null for no features / malformed center", () => {
    expect(parseMapboxResult({ features: [] })).toBeNull();
    expect(parseMapboxResult({})).toBeNull();
    expect(parseMapboxResult(null)).toBeNull();
  });
});

describe("waitMsFor", () => {
  it("waits nothing on the first-ever call", () => {
    expect(waitMsFor(null)).toBe(0);
  });

  it("waits the remainder of the 1s window", () => {
    expect(waitMsFor(1000, 1400)).toBe(600);
  });

  it("waits nothing once the window has already passed", () => {
    expect(waitMsFor(1000, 2500)).toBe(0);
  });

  it("MIN_REQUEST_INTERVAL_MS is 1s (Nominatim's usage policy)", () => {
    expect(MIN_REQUEST_INTERVAL_MS).toBe(1000);
  });
});

describe("isMissingTableError — the migration-not-applied-yet degrade path", () => {
  it("recognises Postgres undefined_table by code", () => {
    expect(isMissingTableError({ code: "42P01", message: "x" })).toBe(true);
  });

  it("recognises it by message when code is absent (PostgREST sometimes omits it)", () => {
    expect(isMissingTableError({ message: 'relation "public.geocode_cache" does not exist' })).toBe(true);
  });

  it("is false for any other error, or no error at all", () => {
    expect(isMissingTableError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("isTrustworthyOffice — precision/name/class gate (issue #153 fix round 2, blocker 2)", () => {
  // Both fixtures below are the ACTUAL shapes measured live against prod
  // (same query, same lib) that fix round 1's distance-only check let through.

  it("rejects a village centroid ('5U AI, Munich' -> Baierbrunn) even though it sits 0.0km from itself", () => {
    // Nominatim's top hit for the company address query is an unrelated
    // village -- an area centroid, not an address. addressdetails carries
    // no road/house_number, so precision is "locality", not "street".
    // jsonv2 -- the format this script requests -- carries this as a
    // top-level `category`, never `class` (verified live; fix round 3
    // blocker 1: the round-2 fixture used the legacy `class` key, so this
    // gate never actually fired against a real jsonv2 response).
    const baierbrunn = parseNominatimResult([
      {
        lat: "47.9928",
        lon: "11.5116",
        display_name: "Baierbrunn, Landkreis München, Bavaria, Germany",
        name: "Baierbrunn",
        category: "place",
        address: { village: "Baierbrunn", county: "Landkreis München", country: "Germany" },
      },
    ]);
    expect(baierbrunn?.precision).toBe("locality");
    expect(isTrustworthyOffice(baierbrunn, "5U AI")).toBe(false);
  });

  it("rejects a same-word street ('Pigment, London' -> Pigment Square) despite street precision", () => {
    // A real road hit -- house_number/road present so precision IS "street"
    // -- but it's a highway, and its own name is the STREET's name, not the
    // company's. Street precision alone must not be enough. jsonv2 shape:
    // `category`, not `class` (see the Baierbrunn fixture above).
    const pigmentSquare = parseNominatimResult([
      {
        lat: "51.505",
        lon: "-0.09",
        display_name: "Pigment Square, Shoreditch, London, England, United Kingdom",
        name: "Pigment Square",
        category: "highway",
        address: { road: "Pigment Square", suburb: "Shoreditch", city: "London", country: "United Kingdom" },
      },
    ]);
    expect(pigmentSquare?.precision).toBe("street");
    expect(isTrustworthyOffice(pigmentSquare, "Pigment")).toBe(false);
  });

  it("reads OSM class from jsonv2's top-level `category` field, and the class gate alone rejects on it", () => {
    // Isolates the REJECT_OFFICE_CLASSES branch from the precision/name
    // checks above it: street precision (road present) AND a name that
    // exactly matches the company -- the ONLY thing standing between this
    // hit and acceptance is `category: "highway"`, carried into `.class`
    // from jsonv2's own field (no legacy `class` key present at all, matching
    // the real API response). If parseNominatimResult still read `hit.class`
    // here it would see `undefined` and this hit would wrongly pass.
    const jsonv2Shaped = parseNominatimResult([
      {
        lat: "51.505",
        lon: "-0.09",
        display_name: "Pigment Square, Shoreditch, London, United Kingdom",
        name: "Pigment Square",
        category: "highway",
        address: { road: "Pigment Square", city: "London" },
      },
    ]);
    expect(jsonv2Shaped?.precision).toBe("street");
    expect(jsonv2Shaped?.class).toBe("highway");
    expect(isTrustworthyOffice(jsonv2Shaped, "Pigment Square")).toBe(false);
  });

  it("accepts a real OSM POI named for the company at street precision (Doctolib)", () => {
    const doctolib = parseNominatimResult([
      {
        lat: "48.8698",
        lon: "2.3412",
        display_name: "Doctolib, 87 Rue de Richelieu, Paris, France",
        name: "Doctolib",
        class: "office",
        address: { house_number: "87", road: "Rue de Richelieu", city: "Paris", country: "France" },
      },
    ]);
    expect(isTrustworthyOffice(doctolib, "Doctolib")).toBe(true);
  });

  it("accepts a real OSM POI named for the company at street precision (Adobe), name-matching case/punctuation-insensitively", () => {
    const adobe = parseNominatimResult([
      {
        lat: "37.3299",
        lon: "-121.8907",
        display_name: "Adobe, 345 Park Avenue, San Jose, California, USA",
        name: "Adobe",
        class: "office",
        address: { house_number: "345", road: "Park Avenue", city: "San Jose", country: "USA" },
      },
    ]);
    // The DB's company name and OSM's own name differ only in case/punctuation
    // -- normalizeForNameMatch folds both, so this still matches.
    expect(isTrustworthyOffice(adobe, "ADOBE.")).toBe(true);
  });

  it("rejects when there is no result, no street precision, or no name at all", () => {
    expect(isTrustworthyOffice(null, "Acme")).toBe(false);
    expect(isTrustworthyOffice({ precision: "locality", class: null, name: "Acme" }, "Acme")).toBe(false);
    expect(isTrustworthyOffice({ precision: "street", class: null, name: null, displayName: null }, "Acme")).toBe(false);
  });

  it("rejects a street-precision hit whose name is a different company entirely", () => {
    expect(
      isTrustworthyOffice({ precision: "street", class: "office", name: "Beta Corp", displayName: null }, "Acme"),
    ).toBe(false);
  });
});

describe("shouldSkipExistingOffice — never overwrite a hand-curated office (issue #153 fix round 1, blocker 2)", () => {
  it("skips a (company_slug, city_key) pair already in the pre-loaded set", () => {
    const existing = new Set([officeKey("acme", "berlin")]);
    expect(shouldSkipExistingOffice(existing, "acme", "berlin")).toBe(true);
  });

  it("does not skip a pair that is not in the set", () => {
    const existing = new Set([officeKey("acme", "berlin")]);
    expect(shouldSkipExistingOffice(existing, "acme", "london")).toBe(false);
    expect(shouldSkipExistingOffice(existing, "other", "berlin")).toBe(false);
  });

  it("an empty set skips nothing", () => {
    expect(shouldSkipExistingOffice(new Set(), "acme", "berlin")).toBe(false);
  });

  it("officeKey is stable and distinguishes both the company and the city", () => {
    expect(officeKey("acme", "berlin")).toBe(officeKey("acme", "berlin"));
    expect(officeKey("acme", "berlin")).not.toBe(officeKey("acme", "london"));
    expect(officeKey("acme", "berlin")).not.toBe(officeKey("beta", "berlin"));
  });
});
