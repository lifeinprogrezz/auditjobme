// GlobeMap — MapLibre GL v5 dark globe for /roles, ported from the approved v43
// mockup (core-roles-page-v43.html lines 291–414). Lazy-loaded: maplibre + its CSS
// import here so vite's manualChunks "maplibre" rule keeps them out of the app chunk.
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import { clusterTier, hueFor, scoreBucket, type RoleJob } from "@/lib/roles";
import { logoUrl } from "@/lib/logodev";

export type GlobeMapProps = {
  jobs: RoleJob[];
  scored: boolean;
  focusLngLats: [number, number][] | null;
  /** Full light identity (paper basemap + light layer palette). Default dark ink. */
  light?: boolean;
  /** Pin click → open that role's detail (startupmap's logo→panel mechanic). */
  onOpenRole?: (id: string) => void;
};

type MapTheme = {
  styleUrl: string;
  sky: Record<string, string>;
  seaStops: [string, string, string, string, string, string];
  hill: { shadow: string; highlight: string; accent: string; exaggeration: number };
  border: { color: string; opacity: number; width: number };
  /** Optional repaint of the basemap's background layer (tone down raw white). */
  baseTint?: string;
  /** Atmosphere glow at the globe rim, zoom-0 strength (default 0.9 = dramatic). */
  atmosphere?: number;
  /** Optional repaint of basemap water fills (the big value-contrast lever). */
  waterColor?: string;
  /** Optional darkening of place/country label text. */
  labelColor?: string;
};

// Dark = the approved ink & graphite palette (7-05); light = paper (Positron).
const THEMES: Record<"dark" | "light", MapTheme> = {
  dark: {
    styleUrl: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    sky: { "sky-color": "#0a1a24", "horizon-color": "#0d2630", "fog-color": "#06121a" },
    seaStops: [
      "rgba(4,8,14,1)", "rgba(7,13,22,1)", "rgba(11,19,31,1)",
      "rgba(15,26,40,1)", "rgba(20,34,50,0.92)", "rgba(18,30,44,0)",
    ],
    hill: { shadow: "#01050a", highlight: "#38434c", accent: "#0d161d", exaggeration: 0.7 },
    border: { color: "#7f95a3", opacity: 0.22, width: 0.6 },
  },
  light: {
    styleUrl: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    // The startupmap-reference halo: a luminous white-blue atmosphere ring
    // glowing against the dark starfield space shared with dark mode.
    sky: { "sky-color": "#cbe3f6", "horizon-color": "#ffffff", "fog-color": "#eaf2f8" },
    // CONTRAST (Rober 7-05): light-mode readability = a real VALUE STEP between
    // land and everything else (the startupmap lesson). Sea is mid-tone, not mist.
    seaStops: [
      "rgba(118,143,162,1)", "rgba(131,155,173,1)", "rgba(144,167,184,1)",
      "rgba(155,177,192,1)", "rgba(165,186,200,0.95)", "rgba(170,190,204,0.55)",
    ],
    hill: { shadow: "#7e8c96", highlight: "#f7fafb", accent: "#b7c3ca", exaggeration: 0.5 },
    border: { color: "#5c7280", opacity: 0.5, width: 0.75 },
    // Land stays light — the step against the darker sea carries the contrast.
    baseTint: "#eff2f4",
    atmosphere: 1,
    waterColor: "#aec3d2",
    labelColor: "#4e5f6a",
  },
};
// The Europe frame is always a fitBounds (never a raw zoom number) — the globe
// projection makes fixed zoom levels frame differently per viewport.
// Startupmap-matched initial framing: more of the sphere + North Atlantic visible.
const EUROPE_BOUNDS: [[number, number], [number, number]] = [[-32, 18], [48, 64]];
// The right panel (358px + margins) eats that side of the viewport: every camera
// move must aim for the VISIBLE centre, or targets land hidden behind the panel.
const EUROPE_PADDING = { top: 80, right: 390, bottom: 80, left: 50 };
// Startupmap's bubble click is a one-shot reveal (easeTo z12/800ms lands on the
// full logo cloud). Our expansion zoom at continent scale often splits into
// sub-clusters instead — so a click always eases to at least clusterMaxZoom+0.6,
// where the sunflower cloud is fully fanned out.
const CITY_REVEAL_ZOOM = 10.6;
// Camera grammar (startupmap-matched): marker-target flights 800ms,
// continent-scale flights (Europe frame, multi-focus) 1200ms.
const FLIGHT_MS = 800;
const CONTINENT_MS = 1200;
const GREAT = "#1FD8B8";

type PinProps = {
  id: string;
  co: string;
  domain: string | null;
  city: string | null;
  role: string;
  score: number | null;
  bucket: string;
  hue: string;
};

function featureCollection(jobs: RoleJob[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: jobs
      .filter((j) => j.lngLat != null)
      .map((j) => ({
        type: "Feature" as const,
        properties: {
          id: j.id,
          co: j.company,
          domain: j.domain,
          city: j.city,
          role: j.title,
          score: j.score,
          // Unscored roles carry NO bucket: a "low" class would paint them with
          // the red poor-fit border in scored mode — a fabricated verdict.
          bucket: j.score != null ? scoreBucket(j.score) : "",
          hue: hueFor(j.company),
        } satisfies PinProps,
        geometry: { type: "Point" as const, coordinates: j.lngLat as [number, number] },
      })),
  };
}

/** Glass cluster bubble (DOM marker — circle layers can't speak the glass system). */
function buildCluster(count: number, maxScore: number): HTMLDivElement {
  const el = document.createElement("div");
  // maxScore -1 = every role unscored → neutral glass; bucket classes only show
  // their colors once the root carries .scored (CSS-gated).
  const bucket = maxScore >= 0 ? scoreBucket(maxScore) : "";
  // Tier ladder (startupmap-matched breaks + weights) lives in clusterTier.
  const t = clusterTier(count);
  el.className = "cluster" + (t.light ? " sm" : "") + (bucket ? ` ${bucket}` : "");
  el.style.width = `${t.size}px`;
  el.style.height = `${t.size}px`;
  // Bigger hubs win marker overlaps (their z ladder: 20/22/24 by count).
  el.style.zIndex = String(t.zIndex);
  const cnt = document.createElement("span");
  cnt.className = "cnt num";
  cnt.style.fontSize = `${t.fontSize}px`;
  // Raw count, never abbreviated (startupmap: the precision reads as honesty).
  cnt.textContent = String(count);
  el.appendChild(cnt);
  if (t.sublabel) {
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = t.sublabel;
    el.appendChild(sub);
  }
  return el;
}

/** Content signature: when a feature's score/bucket changes, the pin DOM must be rebuilt. */
function pinSig(p: PinProps): string {
  return `${p.score ?? ""}|${p.bucket}`;
}

function buildPin(p: PinProps): HTMLDivElement {
  // Wrapper = the maplibre Marker root: maplibre owns its inline transform
  // (translate), so the hover scale must live on the inner disc — a transform
  // on the root would fight the marker positioning.
  const root = document.createElement("div");
  root.className = "pinwrap";
  const el = document.createElement("div");
  el.className = p.bucket ? "pin " + p.bucket : "pin";
  const fallback = document.createElement("span");
  fallback.className = "fallback";
  fallback.style.background = p.hue;
  fallback.textContent = p.co.charAt(0) || "?";
  // light theme: the pin is a WHITE disc — dark-theme marks are white-on-white.
  const src = p.domain ? logoUrl(p.domain, "light") : null;
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.onerror = () => {
      img.style.display = "none";
      fallback.style.display = "grid";
    };
    fallback.style.display = "none";
    img.src = src;
    el.appendChild(img);
  }
  el.appendChild(fallback);
  if (typeof p.score === "number") {
    // Unscored roles get NO badge — never render a fabricated number.
    const sc = document.createElement("span");
    sc.className = "sc num";
    sc.textContent = p.score.toFixed(1);
    el.appendChild(sc);
  }
  root.appendChild(el);
  // Glass tooltip (startupmap's 200ms hover card): role + company · city, plus
  // the fit score CSS-gated on the root .scored class — unscored roles build
  // no pill at all (never fabricate a number).
  const tip = document.createElement("div");
  tip.className = "pintip";
  const row = document.createElement("span");
  row.className = "tiprow";
  const role = document.createElement("span");
  role.className = "tr";
  role.textContent = p.role;
  row.appendChild(role);
  if (typeof p.score === "number") {
    const ts = document.createElement("span");
    ts.className = "tsc num";
    ts.textContent = p.score.toFixed(1);
    row.appendChild(ts);
  }
  const co = document.createElement("span");
  co.className = "tco";
  co.textContent = [p.co, p.city].filter(Boolean).join(" · ");
  tip.append(row, co);
  root.appendChild(tip);
  return root;
}

function styleAtmosphere(map: maplibregl.Map, theme: MapTheme): void {
  try {
    for (const l of map.getStyle().layers) {
      if (theme.baseTint && l.type === "background") {
        map.setPaintProperty(l.id, "background-color", theme.baseTint);
      }
      if (theme.waterColor && l.type === "fill" && /water/i.test(l.id)) {
        try {
          map.setPaintProperty(l.id, "fill-color", theme.waterColor);
        } catch {
          /* some water fills reject repaint */
        }
      }
      if (theme.labelColor && l.type === "symbol" && /place|country|state|city|town|continent|water.?name/i.test(l.id)) {
        try {
          map.setPaintProperty(l.id, "text-color", theme.labelColor);
        } catch {
          /* label classes vary per style */
        }
      }
    }
  } catch {
    /* tints are decoration */
  }
  try {
    map.setSky({
      ...theme.sky,
      "sky-horizon-blend": 0.5,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, theme.atmosphere ?? 0.9, 6, 0.1],
    } as maplibregl.SkySpecification);
  } catch {
    /* sky is decoration */
  }
}

function boostBorders(map: maplibregl.Map, theme: MapTheme): void {
  try {
    for (const l of map.getStyle().layers) {
      if (l.type !== "line" || !/bound|admin|border/i.test(l.id)) continue;
      try {
        map.setPaintProperty(l.id, "line-color", theme.border.color);
        map.setPaintProperty(l.id, "line-opacity", theme.border.opacity);
        map.setPaintProperty(l.id, "line-width", theme.border.width);
      } catch {
        /* some basemap line layers reject individual props */
      }
    }
  } catch {
    /* borders are decoration */
  }
}

function addTerrain(map: maplibregl.Map, theme: MapTheme): void {
  if (map.getSource("dem")) return;
  try {
    map.addSource("dem", {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      // z5 cap: DEM decode work scales with tile churn and blocked the main
      // thread for tens of seconds during multi-zoom flights at maxzoom 13
      // (live-measured). The terrain identity is a globe-scale effect (z2-4.5);
      // overzoomed z5 tiles carry it to the z8 layer cap unnoticed.
      maxzoom: 5,
    });
    // Insert ABOVE the basemap water fill: before the layer that follows the
    // LAST fill layer whose id matches /water/i (the mockup's _fs logic).
    const layers = map.getStyle().layers;
    let before: string | undefined;
    let waterIdx = -1;
    for (let i = 0; i < layers.length; i++) {
      if (/water/i.test(layers[i].id) && layers[i].type === "fill") waterIdx = i;
    }
    if (waterIdx >= 0 && layers[waterIdx + 1]) before = layers[waterIdx + 1].id;
    map.addLayer(
      {
        id: "hillshade",
        type: "hillshade",
        source: "dem",
        // The terrain identity is a GLOBE-scale effect. Past z8 the DEM stack
        // does multi-second main-thread work per view (live-measured 15-18s
        // freezes at z10.6) — cap it where the city basemap takes over anyway.
        maxzoom: 8,
        paint: {
          "hillshade-shadow-color": theme.hill.shadow,
          "hillshade-highlight-color": theme.hill.highlight,
          "hillshade-accent-color": theme.hill.accent,
          "hillshade-exaggeration": theme.hill.exaggeration,
        },
      } as maplibregl.LayerSpecification,
      before,
    );
    try {
      // color-relief exists in maplibre v5; older runtimes reject → warn, never crash.
      map.addLayer(
        {
          id: "sea-color",
          type: "color-relief",
          source: "dem",
          // Same z8 cap as hillshade — see the freeze note above.
          maxzoom: 8,
          paint: {
            "color-relief-color": [
              "interpolate",
              ["linear"],
              ["elevation"],
              -6000, theme.seaStops[0],
              -2500, theme.seaStops[1],
              -800, theme.seaStops[2],
              -200, theme.seaStops[3],
              -20, theme.seaStops[4],
              0, theme.seaStops[5],
              30, "rgba(0,0,0,0)",
            ],
          },
        } as unknown as maplibregl.LayerSpecification,
        before,
      );
    } catch (e) {
      console.warn("color-relief unsupported", e);
    }
  } catch (e) {
    console.warn("hillshade", e);
  }
}

function addRolesLayers(map: maplibregl.Map, data: FeatureCollection): void {
  if (map.getSource("roles")) return;
  map.addSource("roles", {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 46,
    // Cities stay a single glass bubble until city zoom, then the sunflower
    // logo cloud fans out. 9 = startupmap's measured explosion threshold AND
    // the value that makes the one-click reveal complete: with 10, tiles were
    // still clustered at the z10.6 reveal target, so a city click landed on
    // sub-cluster bubbles that were a click dead-end (live-verified on London).
    clusterMaxZoom: 9,
    clusterProperties: { maxScore: ["max", ["coalesce", ["get", "score"], -1]] },
  } as maplibregl.SourceSpecification);
  // Clusters + pins render as DOM markers (synced below) — but a source with NO
  // layer never loads tiles, and querySourceFeatures would return nothing. This
  // invisible layer forces the source to render so the marker sync can read it.
  map.addLayer({
    id: "roles-tiles",
    type: "circle",
    source: "roles",
    paint: { "circle-radius": 0, "circle-opacity": 0 },
  } as unknown as maplibregl.LayerSpecification);
  map.addSource("hl", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "hl",
    type: "circle",
    source: "hl",
    paint: {
      "circle-radius": 17,
      "circle-color": "rgba(31,216,184,.12)",
      "circle-stroke-color": GREAT,
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.9,
    },
  } as unknown as maplibregl.LayerSpecification);
}

function applyFocus(map: maplibregl.Map, focus: [number, number][] | null): void {
  try {
    const src = map.getSource("hl") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (focus) {
      src.setData({
        type: "FeatureCollection",
        features: focus.map((c) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: c },
        })),
      });
      if (focus.length === 1) {
        // Skip-if-already-close (startupmap's guard): re-flying a camera that is
        // effectively at the target reads as a stutter, not a move.
        const ctr = map.getCenter();
        const close =
          Math.abs(map.getZoom() - 4.5) < 0.5 &&
          Math.abs(ctr.lng - focus[0][0]) < 0.01 &&
          Math.abs(ctr.lat - focus[0][1]) < 0.01;
        if (!close) map.flyTo({ center: focus[0], zoom: 4.5, duration: FLIGHT_MS });
      } else if (focus.length > 1) {
        const lo = focus.map((c) => c[0]);
        const la = focus.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lo) - 3, Math.min(...la) - 3],
            [Math.max(...lo) + 3, Math.max(...la) + 3],
          ],
          { padding: { top: 90, right: 400, bottom: 90, left: 60 }, duration: CONTINENT_MS },
        );
      }
    } else {
      src.setData({ type: "FeatureCollection", features: [] });
      map.fitBounds(EUROPE_BOUNDS, { padding: EUROPE_PADDING, duration: CONTINENT_MS });
    }
  } catch {
    /* style mid-load or map mid-teardown */
  }
}

// `scored` stays in the props type for the page contract, but the map needs no
// scored logic: marker bucket classes are permanent and CSS gates them on the
// root .scored class.
export default function GlobeMap({ jobs, focusLngLats, light = false, onOpenRole }: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const pinsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fitTimerRef = useRef<number | undefined>(undefined);
  // Latest props for the async load handler (map init effect runs once).
  const jobsRef = useRef(jobs);
  const focusRef = useRef(focusLngLats);
  const themeRef = useRef<"dark" | "light">(light ? "light" : "dark");
  // Pin click handlers are attached once at marker build — read through a ref
  // so they always call the latest callback.
  const onOpenRoleRef = useRef(onOpenRole);
  onOpenRoleRef.current = onOpenRole;

  const clearPins = () => {
    for (const marker of pinsRef.current.values()) marker.remove();
    pinsRef.current.clear();
  };

  // The atmosphere halo: maplibre's own sky maxes out well below the reference
  // look (bright limb line blooming into space), so we paint it ourselves — a
  // DOM ring tracking the sphere's screen silhouette every frame. The globe's
  // screen circle depends on zoom AND the latitude being viewed, so instead of
  // reproducing maplibre's internal math we sample 12 points on the horizon
  // (89 deg great-circle distance from the view centre), project them, and fit
  // the circle through them (Kasa least-squares). Exact at any camera.
  const updateHalo = () => {
    const map = mapRef.current;
    const halo = haloRef.current;
    if (!map || !halo) return;
    try {
      const c = map.getCanvas();
      const w = c.clientWidth;
      const h = c.clientHeight;
      const ctr = map.getCenter();
      const p1 = (ctr.lat * Math.PI) / 180;
      const l1 = (ctr.lng * Math.PI) / 180;
      // The VISIBLE horizon of a perspective globe is at acos(R/(R+f)) from the
      // view centre (62-75 deg at our zooms), NOT 90: sampling past it made the
      // fitted ring float outside the sphere at some cameras (the "double
      // globe"). Compute it from the live camera each frame.
      const tr = (map as unknown as {
        transform?: { worldSize?: number; cameraToCenterDistance?: number };
      }).transform;
      const worldSize = tr?.worldSize ?? 512 * Math.pow(2, map.getZoom());
      const R = worldSize / (2 * Math.PI);
      const f = tr?.cameraToCenterDistance ?? Math.max(w, h);
      const cosH = Math.min(0.9999, Math.max(0.0001, R / (R + f)));
      const d = Math.acos(cosH) * 0.997;
      let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
      const N = 12;
      for (let k = 0; k < N; k++) {
        const th = (k / N) * 2 * Math.PI;
        const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
        const l2 = l1 + Math.atan2(
          Math.sin(th) * Math.sin(d) * Math.cos(p1),
          Math.cos(d) - Math.sin(p1) * Math.sin(p2),
        );
        const pt = map.project([(l2 * 180) / Math.PI, (p2 * 180) / Math.PI]);
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
        const x = pt.x, y = pt.y, z = x * x + y * y;
        sxx += x * x; sxy += x * y; syy += y * y;
        sx += x; sy += y; sxz += x * z; syz += y * z; sz += z;
      }
      // Solve [sxx sxy sx; sxy syy sy; sx sy N] * [a b cc] = [sxz; syz; sz]
      const det3 = (m0: number[], m1: number[], m2: number[]) =>
        m0[0] * (m1[1] * m2[2] - m1[2] * m2[1]) -
        m0[1] * (m1[0] * m2[2] - m1[2] * m2[0]) +
        m0[2] * (m1[0] * m2[1] - m1[1] * m2[0]);
      const D = det3([sxx, sxy, sx], [sxy, syy, sy], [sx, sy, N]);
      if (Math.abs(D) < 1e-6) return;
      const a = det3([sxz, sxy, sx], [syz, syy, sy], [sz, sy, N]) / D;
      const b = det3([sxx, sxz, sx], [sxy, syz, sy], [sx, sz, N]) / D;
      const cc = det3([sxx, sxy, sxz], [sxy, syy, syz], [sx, sy, sz]) / D;
      const cx = a / 2;
      const cy = b / 2;
      const r2 = cc + cx * cx + cy * cy;
      if (!(r2 > 0)) return;
      // +2px: float the bright line just OUTSIDE the limb so the canvas
      // doesn't swallow half of it.
      const r = Math.sqrt(r2) + 2;
      // Fade out once the limb leaves the viewport (sphere covers the corners).
      const corner = Math.hypot(w, h) / 2;
      const fadeStart = corner * 1.02;
      const fadeEnd = corner * 1.45;
      const rimVisible =
        cx + r > 0 && cx - r < w && cy + r > 0 && cy - r < h;
      const o = !rimVisible || r >= fadeEnd ? 0 : r <= fadeStart ? 1 : 1 - (r - fadeStart) / (fadeEnd - fadeStart);
      halo.style.opacity = o.toFixed(3);
      if (o <= 0) return;
      halo.style.width = `${2 * r}px`;
      halo.style.height = `${2 * r}px`;
      halo.style.left = `${cx - r}px`;
      halo.style.top = `${cy - r}px`;
    } catch {
      /* halo is decoration */
    }
  };

  // One sync for BOTH marker kinds (glass cluster bubbles + logo pins). Reads
  // only refs so the moveend/idle listeners' first-render closure stays valid.
  const syncMarkers = () => {
    const map = mapRef.current;
    if (!map || !map.getSource("roles")) return;
    let feats: ReturnType<maplibregl.Map["querySourceFeatures"]>;
    try {
      feats = map.querySourceFeatures("roles");
    } catch {
      return;
    }
    const pins = pinsRef.current;
    const seen = new Set<string>();
    for (const f of feats) {
      const props = f.properties as Record<string, unknown>;
      const isCluster = Boolean(props.cluster);
      const key = isCluster ? `c${props.cluster_id}` : `p${props.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sig = isCluster
        ? `${props.point_count}|${props.maxScore}`
        : pinSig(props as unknown as PinProps);
      const existing = pins.get(key);
      if (existing) {
        // querySourceFeatures can serve pre-setData tiles; the idle re-sync then
        // reaches here with fresh properties — rebuild the marker if they changed.
        if (existing.getElement().dataset.sig === sig) continue;
        existing.remove();
        pins.delete(key);
      }
      const coords = (f.geometry as GeoPoint).coordinates as [number, number];
      let el: HTMLDivElement;
      if (isCluster) {
        el = buildCluster(Number(props.point_count), Number(props.maxScore));
        const clusterId = props.cluster_id as number;
        el.addEventListener("click", () => {
          const src = map.getSource("roles") as maplibregl.GeoJSONSource | undefined;
          if (!src) return;
          // One-click reveal, supercluster-correct: frame the cluster's MEMBER
          // POINTS, capped at the logo-cloud zoom. A city-sized cluster lands at
          // CITY_REVEAL_ZOOM exactly (fully-fanned sunflower cloud, startupmap's
          // easeTo-z12 feel); a continent-spanning cluster frames its member
          // cities instead — easing to a fixed zoom on the cluster CENTROID put
          // the camera over empty countryside between cities (live-verified on
          // the 432-role Europe bubble).
          src
            .getClusterLeaves(clusterId, 10000, 0)
            .then((leaves) => {
              const pts = leaves
                .map((l) => (l.geometry as GeoPoint).coordinates as [number, number])
                .filter((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]));
              if (!pts.length) return;
              const lo = pts.map((c) => c[0]);
              const la = pts.map((c) => c[1]);
              // Padding aims the content at the VISIBLE centre (left of the
              // panel), so the reveal opens in view instead of behind the glass.
              map.fitBounds(
                [
                  [Math.min(...lo), Math.min(...la)],
                  [Math.max(...lo), Math.max(...la)],
                ],
                { padding: EUROPE_PADDING, maxZoom: CITY_REVEAL_ZOOM, duration: FLIGHT_MS },
              );
            })
            .catch(() => {});
        });
      } else {
        const pin = props as unknown as PinProps;
        el = buildPin(pin);
        const pid = String(pin.id);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onOpenRoleRef.current?.(pid);
        });
      }
      el.dataset.sig = sig;
      const marker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
      pins.set(key, marker);
    }
    for (const [key, marker] of pins) {
      if (!seen.has(key)) {
        marker.remove();
        pins.delete(key);
      }
    }
  };

  useEffect(() => {
    // StrictMode double-mount guard: the first pass's cleanup nulls mapRef.
    if (mapRef.current || !containerRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: THEMES[themeRef.current].styleUrl,
        center: [10, 48],
        zoom: 2.2,
        projection: { type: "globe" },
        attributionControl: false,
        dragRotate: false,
      } as maplibregl.MapOptions);
      mapRef.current = map;
      if (import.meta.env.DEV) {
        (window as unknown as { __rolesMap?: maplibregl.Map }).__rolesMap = map;
      }
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      map.on("moveend", syncMarkers);
      // moveend fires before the new GeoJSON tiles are parsed, and idle can lag
      // seconds behind it (terrain raster trickle) — sync the moment the roles
      // source itself reports loaded, so markers re-cluster right after a
      // reveal flight instead of on the next camera nudge. syncMarkers is
      // sig-deduped, so the extra firings are cheap no-ops.
      map.on("sourcedata", (e) => {
        if (e.sourceId === "roles" && e.isSourceLoaded) syncMarkers();
      });
      map.on("move", updateHalo);
      map.on("resize", updateHalo);
      map.on("load", () => {
        if (mapRef.current !== map) return; // unmounted before style loaded
        // Constructor projection gets reset by style load — set it again.
        try {
          map.setProjection({ type: "globe" });
        } catch {
          /* flat fallback is acceptable */
        }
        fitTimerRef.current = window.setTimeout(() => {
          if (mapRef.current !== map || focusRef.current) return;
          try {
            map.fitBounds(EUROPE_BOUNDS, { padding: EUROPE_PADDING, duration: CONTINENT_MS });
          } catch {
            /* ignore */
          }
        }, 450);
        const theme = THEMES[themeRef.current];
        styleAtmosphere(map, theme);
        boostBorders(map, theme);
        addTerrain(map, theme);
        try {
          addRolesLayers(map, featureCollection(jobsRef.current));
        } catch (e) {
          console.warn("roles layers", e);
        }
        loadedRef.current = true;
        if (focusRef.current) applyFocus(map, focusRef.current);
        updateHalo();
        syncMarkers();
        map.on("idle", syncMarkers);
      });
    } catch (err) {
      // WebGL unavailable / init failure: leave the empty .roles-map div — never crash.
      console.error("map init failed", err);
    }
    return () => {
      window.clearTimeout(fitTimerRef.current);
      loadedRef.current = false;
      clearPins();
      const map = mapRef.current;
      mapRef.current = null;
      if (map) {
        try {
          map.remove();
        } catch {
          /* already gone */
        }
      }
    };
     
  }, []);

  useEffect(() => {
    jobsRef.current = jobs;
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("roles") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    try {
      src.setData(featureCollection(jobs));
    } catch {
      /* ignore */
    }
    // No clear: syncMarkers rebuilds only markers whose sig changed (setData
    // re-tiles async, so this pass may see old tiles — the idle re-sync
    // converges). Scored visuals need no map work at all: bucket classes are
    // always on the markers and the root .scored class gates them in CSS.
    syncMarkers();

  }, [jobs]);

  // Theme flip = full basemap swap: setStyle wipes every source/layer, so we
  // rebuild the stack once the new style reports loaded. Polling (not the
  // style.load event) sidesteps races with the initial load — a flip that
  // lands mid-load simply retargets the style and rebuilds when ready.
  // DOM markers survive setStyle untouched.
  useEffect(() => {
    const next: "dark" | "light" = light ? "light" : "dark";
    if (themeRef.current === next) return;
    themeRef.current = next;
    const map = mapRef.current;
    if (!map) return; // not constructed yet — the constructor reads themeRef
    const theme = THEMES[next];
    loadedRef.current = false;
    let cancelled = false;
    try {
      map.setStyle(theme.styleUrl);
    } catch (e) {
      console.warn("setStyle", e);
    }
    const tryRebuild = () => {
      if (cancelled || mapRef.current !== map) return;
      if (!map.isStyleLoaded()) {
        window.setTimeout(tryRebuild, 150);
        return;
      }
      try {
        map.setProjection({ type: "globe" });
      } catch {
        /* flat fallback is acceptable */
      }
      styleAtmosphere(map, theme);
      boostBorders(map, theme);
      addTerrain(map, theme);
      try {
        addRolesLayers(map, featureCollection(jobsRef.current));
      } catch (e) {
        console.warn("roles layers", e);
      }
      loadedRef.current = true;
      syncMarkers();
    };
    window.setTimeout(tryRebuild, 150);
    return () => {
      cancelled = true;
    };
  }, [light]);

  // Value-compare the focus: scoreBatch re-sorts jobs up to 40 times, giving
  // focusLngLats a fresh identity each time — re-flying the camera on every
  // score would fight the user for the whole pass.
  const lastFocusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    focusRef.current = focusLngLats;
    const key = focusLngLats ? focusLngLats.map((c) => c.join(",")).join(";") : null;
    if (key === lastFocusKeyRef.current) return;
    lastFocusKeyRef.current = key;
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyFocus(map, focusLngLats);

  }, [focusLngLats]);

  return (
    <>
      <div ref={haloRef} className="halo" />
      <div ref={containerRef} className="roles-map" />
    </>
  );
}
