// GlobeMap — MapLibre GL v5 dark globe for /roles, ported from the approved v43
// mockup (core-roles-page-v43.html lines 291–414). Lazy-loaded: maplibre + its CSS
// import here so vite's manualChunks "maplibre" rule keeps them out of the app chunk.
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import { hueFor, scoreBucket, type RoleJob } from "@/lib/roles";
import { logoUrl } from "@/lib/logodev";

export type GlobeMapProps = {
  jobs: RoleJob[];
  scored: boolean;
  focusLngLats: [number, number][] | null;
  /** Full light identity (paper basemap + light layer palette). Default dark ink. */
  light?: boolean;
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
    sky: { "sky-color": "#9fc2dd", "horizon-color": "#f6fbff", "fog-color": "#dfeaf2" },
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
    atmosphere: 0.85,
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
function buildCluster(count: number, abbrev: string, maxScore: number): HTMLDivElement {
  const el = document.createElement("div");
  // maxScore -1 = every role unscored → neutral glass; bucket classes only show
  // their colors once the root carries .scored (CSS-gated).
  const bucket = maxScore >= 0 ? scoreBucket(maxScore) : "";
  // Two-tier weight (startupmap): small counts are light, hubs are ink.
  const tier = count < 10 ? " sm" : "";
  el.className = ("cluster" + tier + (bucket ? ` ${bucket}` : ""));
  const size = count >= 100 ? 76 : count >= 30 ? 64 : count >= 10 ? 54 : 44;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  const cnt = document.createElement("span");
  cnt.className = "cnt num";
  cnt.style.fontSize = count >= 100 ? "17px" : count >= 10 ? "15px" : "13.5px";
  cnt.textContent = abbrev;
  el.appendChild(cnt);
  return el;
}

/** Content signature: when a feature's score/bucket changes, the pin DOM must be rebuilt. */
function pinSig(p: PinProps): string {
  return `${p.score ?? ""}|${p.bucket}`;
}

function buildPin(p: PinProps): HTMLDivElement {
  const el = document.createElement("div");
  el.className = p.bucket ? "pin " + p.bucket : "pin";
  el.dataset.sig = pinSig(p);
  el.title = [p.co, p.role, p.city].filter(Boolean).join(" · ");
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
  return el;
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
      maxzoom: 13,
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
    // Cities stay a single glass bubble until true city zoom; past 10 the
    // sunflower logo cloud fans out OVER the city (startupmap behavior).
    clusterMaxZoom: 10,
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
        map.flyTo({ center: focus[0], zoom: 4.5, duration: 900 });
      } else if (focus.length > 1) {
        const lo = focus.map((c) => c[0]);
        const la = focus.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lo) - 3, Math.min(...la) - 3],
            [Math.max(...lo) + 3, Math.max(...la) + 3],
          ],
          { padding: { top: 90, right: 400, bottom: 90, left: 60 }, duration: 900 },
        );
      }
    } else {
      src.setData({ type: "FeatureCollection", features: [] });
      map.fitBounds(EUROPE_BOUNDS, { padding: EUROPE_PADDING, duration: 800 });
    }
  } catch {
    /* style mid-load or map mid-teardown */
  }
}

// `scored` stays in the props type for the page contract, but the map needs no
// scored logic: marker bucket classes are permanent and CSS gates them on the
// root .scored class.
export default function GlobeMap({ jobs, focusLngLats, light = false }: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const pinsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fitTimerRef = useRef<number | undefined>(undefined);
  // Latest props for the async load handler (map init effect runs once).
  const jobsRef = useRef(jobs);
  const focusRef = useRef(focusLngLats);
  const themeRef = useRef<"dark" | "light">(light ? "light" : "dark");

  const clearPins = () => {
    for (const marker of pinsRef.current.values()) marker.remove();
    pinsRef.current.clear();
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
        el = buildCluster(
          Number(props.point_count),
          String(props.point_count_abbreviated ?? props.point_count),
          Number(props.maxScore),
        );
        const clusterId = props.cluster_id as number;
        el.addEventListener("click", () => {
          const src = map.getSource("roles") as maplibregl.GeoJSONSource | undefined;
          if (!src) return;
          src
            .getClusterExpansionZoom(clusterId)
            // Padding aims the city at the VISIBLE centre (left of the panel),
            // so the logo cloud opens in view instead of behind the glass.
            .then((zoom) =>
              map.easeTo({ center: coords, zoom, duration: 700, padding: EUROPE_PADDING }),
            )
            .catch(() => {});
        });
      } else {
        el = buildPin(props as unknown as PinProps);
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
            map.fitBounds(EUROPE_BOUNDS, { padding: EUROPE_PADDING, duration: 700 });
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

  return <div ref={containerRef} className="roles-map" />;
}
