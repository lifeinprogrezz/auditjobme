import { describe, it, expect } from "vitest";
import { CITY_COORDS, ALIASES, cityOf, coordsOf, jitteredLngLat } from "@/lib/geo";

describe("cityOf", () => {
  it("matches an exact city name", () => {
    expect(cityOf("Barcelona")).toBe("Barcelona");
    expect(cityOf("Toronto")).toBe("Toronto");
  });

  it("matches City, Country / region forms", () => {
    expect(cityOf("Barcelona, Spain")).toBe("Barcelona");
    expect(cityOf("London, England, United Kingdom")).toBe("London");
    expect(cityOf("Berlin, DE")).toBe("Berlin");
    expect(cityOf("Paris, Île-de-France")).toBe("Paris");
    expect(cityOf("Warsaw, Masovian")).toBe("Warsaw");
    expect(cityOf("Amsterdam Area")).toBe("Amsterdam");
    expect(cityOf("Remote - within Dublin")).toBe("Dublin");
  });

  it("resolves native-spelling aliases to the canonical city", () => {
    expect(cityOf("München")).toBe("Munich");
    expect(cityOf("Köln, Germany")).toBe("Cologne");
    expect(cityOf("Wien")).toBe("Vienna");
    expect(cityOf("Praha")).toBe("Prague");
    expect(cityOf("Warszawa")).toBe("Warsaw");
    expect(cityOf("Lisboa, Portugal")).toBe("Lisbon");
    expect(cityOf("Milano")).toBe("Milan");
    expect(cityOf("Den Haag")).toBe("The Hague");
    expect(cityOf("Frankfurt am Main")).toBe("Frankfurt");
  });

  it("is accent-tolerant in both directions", () => {
    expect(cityOf("Zürich")).toBe("Zurich");
    expect(cityOf("Malmo")).toBe("Malmö");
    expect(cityOf("Krakow, Poland")).toBe("Kraków");
    expect(cityOf("Wroclaw")).toBe("Wrocław");
    expect(cityOf("Malaga, Spain")).toBe("Málaga");
    expect(cityOf("Dusseldorf")).toBe("Düsseldorf");
  });

  it("returns null for remote-only strings", () => {
    expect(cityOf("Remote")).toBeNull();
    expect(cityOf("Remote - EU")).toBeNull();
    expect(cityOf("Fully remote")).toBeNull();
    expect(cityOf("EMEA")).toBeNull();
    expect(cityOf("Remote - Germany")).toBeNull();
  });

  it("returns null for unknown / empty / null input", () => {
    expect(cityOf(null)).toBeNull();
    expect(cityOf("")).toBeNull();
    expect(cityOf("Springfield, USA")).toBeNull();
  });

  it("picks the FIRST city by position in the string", () => {
    expect(cityOf("Madrid or Barcelona")).toBe("Madrid");
    expect(cityOf("Barcelona or Madrid")).toBe("Barcelona");
  });

  it("does not match substrings inside longer words", () => {
    expect(cityOf("Londonderry")).toBeNull();
    expect(cityOf("Londonderry, Northern Ireland")).toBeNull();
    expect(cityOf("Romania")).toBeNull(); // "Roma" alias must not fire
  });

  it("every alias points at a real CITY_COORDS entry", () => {
    for (const canonical of Object.values(ALIASES)) {
      expect(CITY_COORDS[canonical]).toBeDefined();
    }
  });
});

describe("coordsOf", () => {
  it("returns coords for a canonical city and null for unknown", () => {
    expect(coordsOf("Barcelona")).toEqual([2.17, 41.39]);
    expect(coordsOf("Atlantis")).toBeNull();
  });
});

describe("jitteredLngLat", () => {
  it("is deterministic for the same jobId", () => {
    const a = jitteredLngLat("Berlin", "job-abc-123");
    const b = jitteredLngLat("Berlin", "job-abc-123");
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it("differs for different jobIds", () => {
    const a = jitteredLngLat("Berlin", "job-1");
    const b = jitteredLngLat("Berlin", "job-2");
    expect(a).not.toEqual(b);
  });

  it("stays within ±0.14 lng / ±0.10 lat of the city center", () => {
    const [lng, lat] = CITY_COORDS["Paris"];
    for (const id of ["a", "b", "c", "long-uuid-0000-1111", "z9"]) {
      const j = jitteredLngLat("Paris", id);
      expect(j).not.toBeNull();
      expect(Math.abs(j![0] - lng)).toBeLessThanOrEqual(0.14 + 1e-9);
      expect(Math.abs(j![1] - lat)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it("returns null for an unknown city", () => {
    expect(jitteredLngLat("Atlantis", "job-1")).toBeNull();
  });
});
