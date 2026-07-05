// GlobeMap — MapLibre GL v5 dark globe for /roles, ported from the approved v43
// mockup (core-roles-page-v43.html lines 291–414). Lazy-loaded: maplibre + its CSS
// import here so vite's manualChunks "maplibre" rule keeps them out of the app chunk.
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import { CLUSTER_SCORE_STEPS, hueFor, scoreBucket, type RoleJob } from "@/lib/roles";
import { logoUrl } from "@/lib/logodev";

export type GlobeMapProps = {
  jobs: RoleJob[];
  scored: boolean;
  focusLngLats: [number, number][] | null;
};

const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
// The Europe frame is always a fitBounds (never a raw zoom number) — the globe
// projection makes fixed zoom levels frame differently per viewport.
const EUROPE_BOUNDS: [[number, number], [number, number]] = [[-30, 20], [45, 64]];
const EUROPE_PADDING = { top: 80, right: 390, bottom: 80, left: 50 };
const GREAT = "#1FD8B8";
const MID = "#FFC44D";
const LOW = "#FF6F4D";
const GREY = "#6E858E"; // cluster whose every role is unscored (maxScore -1)
const CLUSTER_BASE = "#0E2630";

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
          bucket: j.score != null ? scoreBucket(j.score) : "low",
          hue: hueFor(j.company),
        } satisfies PinProps,
        geometry: { type: "Point" as const, coordinates: j.lngLat as [number, number] },
      })),
  };
}

// 0–5 scale: base below 0 (all-unscored), low from 0, mid ≥3, great ≥4.
function scoreRamp(base: string): unknown {
  return [
    "step",
    ["get", "maxScore"],
    base,
    0,
    LOW,
    CLUSTER_SCORE_STEPS.mid,
    MID,
    CLUSTER_SCORE_STEPS.great,
    GREAT,
  ];
}

function paintClusters(map: maplibregl.Map, scored: boolean): void {
  if (!map.getLayer("clusters") || !map.getLayer("clusters-glow")) return;
  map.setPaintProperty("clusters", "circle-color", scored ? scoreRamp(GREY) : CLUSTER_BASE);
  map.setPaintProperty("clusters-glow", "circle-color", scored ? scoreRamp(GREAT) : GREAT);
  map.setPaintProperty("clusters-glow", "circle-opacity", scored ? 0.6 : 0.22);
}

function buildPin(p: PinProps): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pin " + p.bucket;
  el.title = [p.co, p.role, p.city].filter(Boolean).join(" · ");
  const fallback = document.createElement("span");
  fallback.className = "fallback";
  fallback.style.background = p.hue;
  fallback.textContent = p.co.charAt(0) || "?";
  const src = p.domain ? logoUrl(p.domain) : null;
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

function styleAtmosphere(map: maplibregl.Map): void {
  try {
    map.setSky({
      "sky-color": "#0a1a24",
      "sky-horizon-blend": 0.5,
      "horizon-color": "#0d2630",
      "horizon-fog-blend": 0.5,
      "fog-color": "#06121a",
      "fog-ground-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 6, 0.2],
    } as maplibregl.SkySpecification);
  } catch {
    /* sky is decoration */
  }
}

function boostBorders(map: maplibregl.Map): void {
  try {
    for (const l of map.getStyle().layers) {
      if (l.type !== "line" || !/bound|admin|border/i.test(l.id)) continue;
      try {
        map.setPaintProperty(l.id, "line-color", "#5AC8DA");
        map.setPaintProperty(l.id, "line-opacity", 0.45);
        map.setPaintProperty(l.id, "line-width", 0.8);
      } catch {
        /* some basemap line layers reject individual props */
      }
    }
  } catch {
    /* borders are decoration */
  }
}

function addTerrain(map: maplibregl.Map): void {
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
          "hillshade-shadow-color": "#02090d",
          "hillshade-highlight-color": "#3f7d8c",
          "hillshade-accent-color": "#0a2a33",
          "hillshade-exaggeration": 0.7,
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
              -6000,
              "rgba(5,18,30,1)",
              -2500,
              "rgba(7,34,54,1)",
              -800,
              "rgba(11,52,78,1)",
              -200,
              "rgba(16,78,104,1)",
              -20,
              "rgba(22,104,128,0.92)",
              0,
              "rgba(20,90,112,0)",
              30,
              "rgba(0,0,0,0)",
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
  map.addSource("roles", {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 5,
    clusterProperties: { maxScore: ["max", ["coalesce", ["get", "score"], -1]] },
  } as maplibregl.SourceSpecification);
  map.addLayer({
    id: "clusters-glow",
    type: "circle",
    source: "roles",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": GREAT,
      "circle-opacity": 0.22,
      "circle-opacity-transition": { duration: 700 },
      "circle-blur": 1,
      "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 26, 20, 52],
    },
  } as unknown as maplibregl.LayerSpecification);
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "roles",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": CLUSTER_BASE,
      "circle-color-transition": { duration: 700 },
      "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 19, 8, 28, 20, 40],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "rgba(120,215,230,.55)",
    },
  } as unknown as maplibregl.LayerSpecification);
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "roles",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Open Sans Bold"],
      "text-size": 15,
    },
    paint: { "text-color": "#fff" },
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

export default function GlobeMap({ jobs, scored, focusLngLats }: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const pinsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fitTimerRef = useRef<number | undefined>(undefined);
  // Latest props for the async load handler (map init effect runs once).
  const jobsRef = useRef(jobs);
  const scoredRef = useRef(scored);
  const focusRef = useRef(focusLngLats);

  const clearPins = () => {
    for (const marker of pinsRef.current.values()) marker.remove();
    pinsRef.current.clear();
  };

  // Reads only refs so the moveend/idle listeners' first-render closure stays valid.
  const syncPins = () => {
    const map = mapRef.current;
    if (!map || !map.getSource("roles")) return;
    let feats: ReturnType<maplibregl.Map["querySourceFeatures"]>;
    try {
      feats = map.querySourceFeatures("roles", { filter: ["!", ["has", "point_count"]] });
    } catch {
      return;
    }
    const pins = pinsRef.current;
    const seen = new Set<string>();
    for (const f of feats) {
      const p = f.properties as PinProps;
      const id = String(p.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (pins.has(id)) continue;
      const coords = (f.geometry as GeoPoint).coordinates as [number, number];
      const marker = new maplibregl.Marker({ element: buildPin(p) }).setLngLat(coords).addTo(map);
      pins.set(id, marker);
    }
    for (const [id, marker] of pins) {
      if (!seen.has(id)) {
        marker.remove();
        pins.delete(id);
      }
    }
  };

  useEffect(() => {
    // StrictMode double-mount guard: the first pass's cleanup nulls mapRef.
    if (mapRef.current || !containerRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: [10, 48],
        zoom: 2.2,
        projection: { type: "globe" },
        attributionControl: false,
        dragRotate: false,
      } as maplibregl.MapOptions);
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      map.on("moveend", syncPins);
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
        styleAtmosphere(map);
        boostBorders(map);
        addTerrain(map);
        try {
          addRolesLayers(map, featureCollection(jobsRef.current));
          map.on("click", "clusters", (e) => {
            const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
            const src = map.getSource("roles") as maplibregl.GeoJSONSource | undefined;
            if (!f || !src) return;
            const center = (f.geometry as GeoPoint).coordinates as [number, number];
            src
              .getClusterExpansionZoom(f.properties.cluster_id as number)
              .then((zoom) => map.easeTo({ center, zoom, duration: 700 }))
              .catch(() => {});
          });
          map.on("mouseenter", "clusters", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "clusters", () => {
            map.getCanvas().style.cursor = "";
          });
        } catch (e) {
          console.warn("roles layers", e);
        }
        loadedRef.current = true;
        paintClusters(map, scoredRef.current);
        if (focusRef.current) applyFocus(map, focusRef.current);
        syncPins();
        map.on("idle", syncPins);
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
    clearPins();
    syncPins(); // idle listener re-syncs again once the new data renders
     
  }, [jobs]);

  useEffect(() => {
    scoredRef.current = scored;
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    paintClusters(map, scored);
    // Pins bake bucket class + badge into the DOM: clear + resync re-renders them.
    clearPins();
    syncPins();
     
  }, [scored]);

  useEffect(() => {
    focusRef.current = focusLngLats;
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyFocus(map, focusLngLats);
     
  }, [focusLngLats]);

  return <div ref={containerRef} className="roles-map" />;
}
