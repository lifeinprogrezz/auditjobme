// Deterministic geo resolution for the /roles globe (issue #14).
// One messy free-text location column in → canonical city + jittered [lng,lat] out.
// Pure functions, no I/O, no Math.random (map pins must be stable across renders).

/** Canonical city → [lng, lat] (2-decimal precision is enough at globe zoom). */
export const CITY_COORDS: Record<string, [number, number]> = {
  // Spain
  Barcelona: [2.17, 41.39],
  Madrid: [-3.7, 40.42],
  Valencia: [-0.38, 39.47],
  "Málaga": [-4.42, 36.72],
  Bilbao: [-2.93, 43.26],
  Sevilla: [-5.98, 37.39],
  // UK + Ireland
  London: [-0.13, 51.51],
  Cambridge: [0.12, 52.21],
  Oxford: [-1.26, 51.75],
  Manchester: [-2.24, 53.48],
  Edinburgh: [-3.19, 55.95],
  Bristol: [-2.59, 51.45],
  Dublin: [-6.26, 53.35],
  // France
  Paris: [2.35, 48.86],
  Lyon: [4.84, 45.76],
  Toulouse: [1.44, 43.6],
  Bordeaux: [-0.58, 44.84],
  Marseille: [5.37, 43.3],
  Nantes: [-1.55, 47.22],
  Lille: [3.06, 50.63],
  // Germany
  Berlin: [13.4, 52.52],
  Munich: [11.58, 48.14],
  Hamburg: [9.99, 53.55],
  Cologne: [6.96, 50.94],
  Frankfurt: [8.68, 50.11],
  Stuttgart: [9.18, 48.78],
  "Düsseldorf": [6.78, 51.23],
  Leipzig: [12.37, 51.34],
  Karlsruhe: [8.4, 49.01],
  // Benelux
  Amsterdam: [4.9, 52.37],
  Rotterdam: [4.48, 51.92],
  Utrecht: [5.12, 52.09],
  Eindhoven: [5.47, 51.44],
  "The Hague": [4.3, 52.08],
  Brussels: [4.35, 50.85],
  Antwerp: [4.4, 51.22],
  Ghent: [3.72, 51.05],
  Luxembourg: [6.13, 49.61],
  // Switzerland + Austria
  Zurich: [8.54, 47.37],
  Geneva: [6.14, 46.2],
  Basel: [7.59, 47.56],
  Lausanne: [6.63, 46.52],
  Bern: [7.45, 46.95],
  Vienna: [16.37, 48.21],
  Graz: [15.44, 47.07],
  // Nordics
  Stockholm: [18.07, 59.33],
  Gothenburg: [11.97, 57.71],
  "Malmö": [13.0, 55.6],
  Copenhagen: [12.57, 55.68],
  Aarhus: [10.21, 56.16],
  Oslo: [10.75, 59.91],
  Helsinki: [24.94, 60.17],
  Tampere: [23.76, 61.5],
  Reykjavik: [-21.94, 64.15],
  // Italy
  Milan: [9.19, 45.46],
  Rome: [12.5, 41.9],
  Turin: [7.69, 45.07],
  Bologna: [11.34, 44.49],
  Florence: [11.26, 43.77],
  // Portugal
  Lisbon: [-9.14, 38.72],
  Porto: [-8.61, 41.15],
  Braga: [-8.43, 41.55],
  // Poland
  Warsaw: [21.01, 52.23],
  "Kraków": [19.94, 50.06],
  "Wrocław": [17.03, 51.11],
  "Gdańsk": [18.65, 54.35],
  "Poznań": [16.93, 52.41],
  // Central + Eastern Europe
  Prague: [14.44, 50.08],
  Brno: [16.61, 49.2],
  Bratislava: [17.11, 48.15],
  Budapest: [19.04, 47.5],
  Bucharest: [26.1, 44.43],
  "Cluj-Napoca": [23.6, 46.77],
  Sofia: [23.32, 42.7],
  Athens: [23.73, 37.98],
  Thessaloniki: [22.94, 40.64],
  Zagreb: [15.98, 45.81],
  Ljubljana: [14.51, 46.05],
  Belgrade: [20.46, 44.79],
  // Baltics
  Tallinn: [24.75, 59.44],
  Riga: [24.11, 56.95],
  Vilnius: [25.28, 54.69],
  // Wider Europe
  Kyiv: [30.52, 50.45],
  Istanbul: [28.98, 41.01],
  Nicosia: [33.36, 35.17],
  Valletta: [14.51, 35.9],
  // Canada (pool includes CA roles)
  Toronto: [-79.38, 43.65],
  Vancouver: [-123.12, 49.28],
};

/** Local / native / variant spellings → canonical CITY_COORDS key.
 * Accent-only variants (Zürich, Kraków, Malmö…) are already covered by fold();
 * this map is for genuinely different names. */
export const ALIASES: Record<string, string> = {
  "München": "Munich",
  Muenchen: "Munich",
  "Köln": "Cologne",
  Koeln: "Cologne",
  Wien: "Vienna",
  Praha: "Prague",
  Warszawa: "Warsaw",
  Lisboa: "Lisbon",
  Milano: "Milan",
  Roma: "Rome",
  Torino: "Turin",
  Firenze: "Florence",
  "Genève": "Geneva",
  "Zürich": "Zurich",
  Zuerich: "Zurich",
  Bruxelles: "Brussels",
  Brussel: "Brussels",
  Kobenhavn: "Copenhagen",
  "København": "Copenhagen",
  "Frankfurt am Main": "Frankfurt",
  "Den Haag": "The Hague",
  "s-Gravenhage": "The Hague",
  Krakow: "Kraków",
  Wroclaw: "Wrocław",
  Duesseldorf: "Düsseldorf",
  "Göteborg": "Gothenburg",
  "Århus": "Aarhus",
  Antwerpen: "Antwerp",
  Gent: "Ghent",
  Seville: "Sevilla",
  "București": "Bucharest",
  Cluj: "Cluj-Napoca",
  Beograd: "Belgrade",
  Kiev: "Kyiv",
  Athina: "Athens",
};

/** Lowercase + strip diacritics + map the non-decomposing letters (ł, ø…). */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss");
}

const ENTRIES: { needle: string; canonical: string }[] = [
  ...Object.keys(CITY_COORDS).map((c) => ({ needle: fold(c), canonical: c })),
  ...Object.entries(ALIASES).map(([a, c]) => ({ needle: fold(a), canonical: c })),
];

const COORDS_BY_FOLD: Record<string, [number, number]> = {};
for (const [c, xy] of Object.entries(CITY_COORDS)) COORDS_BY_FOLD[fold(c)] = xy;
for (const [a, c] of Object.entries(ALIASES)) {
  const xy = CITY_COORDS[c];
  if (xy && !COORDS_BY_FOLD[fold(a)]) COORDS_BY_FOLD[fold(a)] = xy;
}

const isWordChar = (ch: string): boolean => /[a-z0-9]/.test(ch);

/** First whole-word occurrence of needle in hay, else -1 (blocks Londonderry→London). */
function findWord(hay: string, needle: string): number {
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return -1;
    const before = i > 0 ? hay[i - 1] : "";
    const after = hay[i + needle.length] ?? "";
    if (!isWordChar(before) && !isWordChar(after)) return i;
    from = i + 1;
  }
}

/** Scan a messy free-text location for the FIRST known city (by position in the
 * string, so "Madrid or Barcelona" → Madrid). Remote-only strings → null. */
export function cityOf(location: string | null): string | null {
  if (!location) return null;
  const hay = fold(location);
  if (!hay.trim()) return null;
  let best: { pos: number; len: number; canonical: string } | null = null;
  for (const { needle, canonical } of ENTRIES) {
    const pos = findWord(hay, needle);
    if (pos < 0) continue;
    if (!best || pos < best.pos || (pos === best.pos && needle.length > best.len)) {
      best = { pos, len: needle.length, canonical };
    }
  }
  return best ? best.canonical : null;
}

export function coordsOf(city: string): [number, number] | null {
  return CITY_COORDS[city] ?? COORDS_BY_FOLD[fold(city)] ?? null;
}

function hash32(s: string): number {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** City coords jittered by a hash of jobId so co-located pins fan out.
 * Same spread as the mockup's seeded rnd: lng ±0.14 max, lat ±0.10 max.
 * Deterministic — same jobId always yields the same point. */
export function jitteredLngLat(city: string, jobId: string): [number, number] | null {
  const base = coordsOf(city);
  if (!base) return null;
  let seed = hash32(jobId) || 1;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  return [base[0] + rnd() * 0.28, base[1] + rnd() * 0.2];
}

const GOLDEN_ANGLE = 2.399963229728653; // radians — sunflower phyllotaxis

/**
 * Deterministic sunflower packing around the city centre: job `index` (stable
 * per-city ordering) sits at angle i·golden-angle, radius a·√i. The result is a
 * tight organic disc OVER the city — the startupmap-style logo cloud — instead
 * of random scatter. Disc radius is capped ≈6–7 km however many roles a city
 * has (per-city spacing shrinks as the count grows).
 */
export function sunflowerLngLat(
  city: string,
  index: number,
  cityCount: number,
): [number, number] | null {
  const base = coordsOf(city);
  if (!base) return null;
  if (index <= 0 && cityCount <= 1) return base;
  const a = Math.min(0.0065, 0.06 / Math.sqrt(Math.max(cityCount, 1)));
  const r = a * Math.sqrt(index);
  const theta = index * GOLDEN_ANGLE;
  const lat = base[1] + r * Math.sin(theta);
  // stretch lng by 1/cos(lat) so the disc stays visually circular on the map
  const lng = base[0] + (r * Math.cos(theta)) / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  return [lng, lat];
}
