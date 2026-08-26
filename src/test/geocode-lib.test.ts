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
