import maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MaplibreMap,
  RasterTileSource,
  StyleSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import type { SeedmapDebug } from "./debug-types";
import { biomeSearchPlan, nearestMatchInGrid } from "./lib/biome-search";
import { debounce } from "./lib/debounce";
import { el } from "./lib/dom";
import { formatHash, parseHash, type HashState } from "./lib/hash-state";
import { compactLayerTokens, expandLayerTokens } from "./lib/layer-tokens";
import { OracleClient, OracleError, resolveOracleBase } from "./lib/oracle-client";
import { oracleTileUrlTemplate } from "./lib/oracle-url";
import {
  DISPLAY_ZOOM_MAX,
  DISPLAY_ZOOM_MIN,
  MAX_MERCATOR_LAT,
  WORLD_RADIUS_BLOCKS,
  blockToLngLat,
  latToBlockZ,
  lngToBlockX,
} from "./lib/projection";
import type {
  BiomeRegistryEntry,
  OracleMeta,
  PlacedFeature,
  StructureRegistryEntry,
} from "./lib/types";
import { registerOracleProtocol } from "./protocol";
import { createBanner } from "./ui/banner";
import { createCursorReadout } from "./ui/cursor-readout";
import { createLegend } from "./ui/legend";
import { renderRetryCard } from "./ui/retry-card";
import { createSearchPanel } from "./ui/search-panel";
import { createStructuresPanel } from "./ui/structures-panel";

/** Map zoom range: source tiles live in [4, 10]; up to 12 overzooms z=0 tiles. */
const MIN_MAP_ZOOM = DISPLAY_ZOOM_MIN;
const MAX_MAP_ZOOM = 12;
const DEFAULT_ZOOM = 6;
const DEFAULT_Y_LEVEL = 64;
/** /structures/placed bbox cap per the contract: 512x512 chunks. */
const PLACED_BBOX_LIMIT_BLOCKS = 512 * 16;

const TILE_SOURCE = "biome-tiles";
const TILE_LAYER = "biome-tiles-layer";
const STRUCTURES_SOURCE = "structures";
const STRUCTURES_LAYER = "structures-layer";
const RESULT_SOURCE = "search-result";
const RESULT_LAYER = "search-result-layer";

interface AppContext {
  base: string;
  client: OracleClient;
  meta: OracleMeta;
  structures: StructureRegistryEntry[];
  biomes: BiomeRegistryEntry[];
}

const EMPTY_FC: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function boot(root: HTMLElement): Promise<void> {
  const base = resolveOracleBase(location.search);
  const client = new OracleClient(base);
  root.replaceChildren(el("div", { class: "loading" }, "Connecting to oracle…"));
  let ctx: AppContext;
  try {
    const meta = await client.meta();
    const [rs, rb] = await Promise.all([
      client.registryStructures(),
      client.registryBiomes(),
    ]);
    ctx = { base, client, meta, structures: rs.structures, biomes: rb.biomes };
  } catch (err) {
    renderRetryCard(root, base, err, () => {
      void boot(root);
    });
    return;
  }
  renderApp(root, ctx);
}

function renderApp(root: HTMLElement, ctx: AppContext): void {
  const allStructureIds = ctx.structures.map((s) => s.id);
  const initialHash = parseHash(location.hash);

  const fallbackDim = ctx.meta.dimensions[0] ?? "minecraft:overworld";
  const state = {
    dim:
      initialHash && ctx.meta.dimensions.includes(initialHash.dim)
        ? initialHash.dim
        : fallbackDim,
    yLevel: DEFAULT_Y_LEVEL,
    startOk: false,
    enabled: initialHash?.layers
      ? expandLayerTokens(initialHash.layers, allStructureIds)
      : new Set<string>(),
    pickPointFor: null as string | null,
  };
  const center = initialHash
    ? {
        x: clamp(initialHash.x, -WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS - 1),
        z: clamp(initialHash.z, -WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS - 1),
      }
    : { x: 0, z: 0 };
  const initialZoom = clamp(
    initialHash?.zoom ?? DEFAULT_ZOOM,
    MIN_MAP_ZOOM,
    MAX_MAP_ZOOM,
  );

  // ---- DOM skeleton -------------------------------------------------------
  const mapDiv = el("div", { id: "map" });
  const readout = createCursorReadout();

  const banner = createBanner({
    meta: ctx.meta,
    initialDim: state.dim,
    initialY: state.yLevel,
    onDimChange(dim) {
      state.dim = dim;
      updateTiles();
      readout.setBiome(null);
      refreshMarkers();
      scheduleHashUpdate();
    },
    onYChange(y) {
      state.yLevel = y;
      updateTiles();
      readout.setBiome(null);
    },
  });

  const structuresPanel = createStructuresPanel({
    entries: ctx.structures,
    enabled: state.enabled,
    startOk: state.startOk,
    onChange(startOk) {
      state.startOk = startOk;
      refreshMarkers();
      scheduleHashUpdate();
    },
  });

  const searchPanel = createSearchPanel({
    structures: ctx.structures,
    biomes: ctx.biomes,
    onLocate(structureId, origin) {
      if (origin === "pick") {
        state.pickPointFor = structureId;
        searchPanel.setLocateStatus("Click a point on the map…");
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const c = map.getCenter();
      void runLocate(structureId, {
        x: Math.round(lngToBlockX(c.lng)),
        z: Math.round(latToBlockZ(c.lat)),
      });
    },
    onBiomeSearch(biomeId) {
      void runBiomeSearch(biomeId);
    },
  });

  const sidePanel = el(
    "aside",
    { class: "panel panel-side" },
    searchPanel.element,
    createLegend(ctx.biomes),
  );

  root.replaceChildren(
    banner.element,
    el("main", { class: "map-wrap" }, mapDiv, structuresPanel.element, sidePanel, readout.element),
  );

  // ---- Map ----------------------------------------------------------------
  const debug: SeedmapDebug = {
    get map(): unknown {
      return map;
    },
    ready: false,
    tilesLoaded: 0,
    lastStructureCount: -1,
    queryStructureFeatures(): number {
      if (!map.getLayer(STRUCTURES_LAYER)) return 0;
      return map.queryRenderedFeatures({ layers: [STRUCTURES_LAYER] }).length;
    },
    onIdle(): Promise<void> {
      return new Promise((resolve) => {
        if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) {
          resolve();
          return;
        }
        void map.once("idle", () => {
          resolve();
        });
      });
    },
  };
  window.__seedmap = debug;

  registerOracleProtocol(() => {
    debug.tilesLoaded += 1;
  });

  const style: StyleSpecification = {
    version: 8,
    name: "seedmap",
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0c1014" },
      },
    ],
  };

  const startLngLat = blockToLngLat(center.x, center.z);
  const map: MaplibreMap = new maplibregl.Map({
    container: mapDiv,
    style,
    center: [startLngLat.lng, startLngLat.lat],
    zoom: initialZoom,
    minZoom: MIN_MAP_ZOOM,
    maxZoom: MAX_MAP_ZOOM,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: 0,
    // No maxBounds: near-world-sized bounds make MapLibre 5's constrain
    // matrix singular (null-matrix crash in _calcMatrices). Latitude is
    // already clamped by mercator; block-space queries clamp to the window.
  });
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    "bottom-right",
  );

  const tileTemplate = (): string =>
    oracleTileUrlTemplate(ctx.base, state.dim, state.yLevel);

  function updateTiles(): void {
    const source = map.getSource<RasterTileSource>(TILE_SOURCE);
    source?.setTiles([tileTemplate()]);
  }

  const levelColor: ExpressionSpecification = [
    "match",
    ["get", "level"],
    "start_ok",
    "#34c759",
    "biome_ok",
    "#e8b34b",
    "#9aa0a6",
  ];

  map.on("load", () => {
    map.addSource(TILE_SOURCE, {
      type: "raster",
      tiles: [tileTemplate()],
      tileSize: 256,
      minzoom: DISPLAY_ZOOM_MIN,
      maxzoom: DISPLAY_ZOOM_MAX,
      bounds: [-180, -MAX_MERCATOR_LAT, 180, MAX_MERCATOR_LAT],
    });
    map.addLayer({
      id: TILE_LAYER,
      type: "raster",
      source: TILE_SOURCE,
      paint: { "raster-resampling": "nearest" },
    });
    map.addSource(STRUCTURES_SOURCE, { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: STRUCTURES_LAYER,
      type: "circle",
      source: STRUCTURES_SOURCE,
      paint: {
        "circle-color": levelColor,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          MIN_MAP_ZOOM,
          3,
          MAX_MAP_ZOOM,
          7,
        ] as unknown as ExpressionSpecification,
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#0c1014",
      },
    });
    map.addSource(RESULT_SOURCE, { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: RESULT_LAYER,
      type: "circle",
      source: RESULT_SOURCE,
      paint: {
        "circle-color": "#ff5d8f",
        "circle-radius": 8,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    refreshMarkers();
    debug.ready = true;
  });

  // ---- Structure markers --------------------------------------------------
  let markerToken = 0;

  function typesForCurrentDim(): string[] {
    return ctx.structures
      .filter((s) => s.dimensions.includes(state.dim) && state.enabled.has(s.id))
      .map((s) => s.id);
  }

  function setStructuresData(fc: FeatureCollection<Point>): void {
    const source = map.getSource<GeoJSONSource>(STRUCTURES_SOURCE);
    source?.setData(fc);
  }

  function featuresToFC(features: PlacedFeature[]): FeatureCollection<Point> {
    return {
      type: "FeatureCollection",
      features: features.map((f): Feature<Point> => {
        const { lng, lat } = blockToLngLat(f.x, f.z);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            id: f.id,
            structureSet: f.structureSet,
            x: f.x,
            z: f.z,
            chunkX: f.chunkX,
            chunkZ: f.chunkZ,
            level: f.level,
          },
        };
      }),
    };
  }

  async function refreshMarkersNow(): Promise<void> {
    const token = ++markerToken;
    const types = typesForCurrentDim();
    if (types.length === 0) {
      setStructuresData(EMPTY_FC);
      debug.lastStructureCount = 0;
      structuresPanel.setStatus("No structure layers enabled.");
      return;
    }
    const bounds = map.getBounds();
    let minX = Math.floor(lngToBlockX(bounds.getWest()));
    let maxX = Math.ceil(lngToBlockX(bounds.getEast()));
    let minZ = Math.floor(latToBlockZ(bounds.getNorth()));
    let maxZ = Math.ceil(latToBlockZ(bounds.getSouth()));
    let clamped = false;
    if (maxX - minX > PLACED_BBOX_LIMIT_BLOCKS) {
      const cx = Math.round((minX + maxX) / 2);
      minX = cx - PLACED_BBOX_LIMIT_BLOCKS / 2;
      maxX = cx + PLACED_BBOX_LIMIT_BLOCKS / 2;
      clamped = true;
    }
    if (maxZ - minZ > PLACED_BBOX_LIMIT_BLOCKS) {
      const cz = Math.round((minZ + maxZ) / 2);
      minZ = cz - PLACED_BBOX_LIMIT_BLOCKS / 2;
      maxZ = cz + PLACED_BBOX_LIMIT_BLOCKS / 2;
      clamped = true;
    }
    minX = clamp(minX, -WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS);
    maxX = clamp(maxX, -WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS);
    minZ = clamp(minZ, -WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS);
    maxZ = clamp(maxZ, -WORLD_RADIUS_BLOCKS, WORLD_RADIUS_BLOCKS);
    structuresPanel.setStatus("Loading markers…");
    try {
      const response = await ctx.client.structuresPlaced({
        dim: state.dim,
        minX,
        minZ,
        maxX,
        maxZ,
        types,
        level: state.startOk ? "start_ok" : "biome_ok",
      });
      if (token !== markerToken) return;
      setStructuresData(featuresToFC(response.features));
      debug.lastStructureCount = response.features.length;
      structuresPanel.setStatus(
        `${response.features.length} markers` +
          (clamped ? " · central 8192×8192 blocks only — zoom in" : ""),
      );
    } catch (err) {
      if (token !== markerToken) return;
      structuresPanel.setStatus(`Marker fetch failed: ${errorMessage(err)}`);
    }
  }

  const refreshMarkers = debounce(() => {
    void refreshMarkersNow();
  }, 250);

  // ---- Popups & clicks ----------------------------------------------------
  map.on("click", (e) => {
    if (state.pickPointFor === null) return;
    const structureId = state.pickPointFor;
    state.pickPointFor = null;
    map.getCanvas().style.cursor = "";
    void runLocate(structureId, {
      x: Math.round(lngToBlockX(e.lngLat.lng)),
      z: Math.round(latToBlockZ(e.lngLat.lat)),
    });
  });

  map.on("click", STRUCTURES_LAYER, (e) => {
    if (state.pickPointFor !== null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const p = feature.properties as {
      id: string;
      x: number;
      z: number;
      chunkX: number;
      chunkZ: number;
      level: string;
    };
    const tp = `/tp @s ${p.x} ~ ${p.z}`;
    const copyBtn = el("button", { class: "mini-btn", type: "button" }, "copy /tp");
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(tp).then(
        () => (copyBtn.textContent = "copied!"),
        () => (copyBtn.textContent = "copy failed"),
      );
    });
    const content = el(
      "div",
      { class: "feature-popup" },
      el("div", { class: "mono popup-id" }, p.id),
      el("div", {}, `x ${p.x}, z ${p.z} · chunk ${p.chunkX}, ${p.chunkZ}`),
      el(
        "div",
        { class: "popup-row" },
        el("span", { class: `badge badge-${p.level}` }, p.level),
        copyBtn,
      ),
    );
    new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
      .setLngLat(e.lngLat)
      .setDOMContent(content)
      .addTo(map);
  });

  map.on("mouseenter", STRUCTURES_LAYER, () => {
    if (state.pickPointFor === null) map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", STRUCTURES_LAYER, () => {
    if (state.pickPointFor === null) map.getCanvas().style.cursor = "";
  });

  // ---- Cursor readout -----------------------------------------------------
  let biomeLookupToken = 0;
  const biomeLookup = debounce((x: number, z: number) => {
    const token = ++biomeLookupToken;
    ctx.client
      .biome(state.dim, x, state.yLevel, z)
      .then((r) => {
        if (token === biomeLookupToken) readout.setBiome(r.biome);
      })
      .catch(() => {
        if (token === biomeLookupToken) readout.setBiome(null);
      });
  }, 180);

  map.on("mousemove", (e) => {
    const x = Math.floor(lngToBlockX(e.lngLat.lng));
    const z = Math.floor(latToBlockZ(e.lngLat.lat));
    readout.setPosition(x, z);
    biomeLookup(x, z);
  });
  mapDiv.addEventListener("mouseleave", () => {
    biomeLookup.cancel();
    readout.clear();
  });

  // ---- Search: /locate ----------------------------------------------------
  function showResultMarker(x: number, z: number): void {
    const { lng, lat } = blockToLngLat(x, z);
    const source = map.getSource<GeoJSONSource>(RESULT_SOURCE);
    source?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {},
        },
      ],
    });
  }

  function flyToBlock(x: number, z: number): void {
    const { lng, lat } = blockToLngLat(x, z);
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 9) });
  }

  async function runLocate(
    structureId: string,
    origin: { x: number; z: number },
  ): Promise<void> {
    searchPanel.setLocateStatus(`Locating ${structureId}…`);
    try {
      const result = await ctx.client.locate(state.dim, origin.x, origin.z, structureId);
      searchPanel.setLocateResult(result, () => {
        showResultMarker(result.x, result.z);
        flyToBlock(result.x, result.z);
      });
      showResultMarker(result.x, result.z);
    } catch (err) {
      if (err instanceof OracleError && err.code === "not_found") {
        searchPanel.setLocateStatus(`No ${structureId} found nearby.`);
      } else {
        searchPanel.setLocateStatus(`Locate failed: ${errorMessage(err)}`);
      }
    }
  }

  // ---- Search: nearest biome (expanding rings over /biomes/grid) ----------
  let biomeSearchToken = 0;

  async function runBiomeSearch(biomeId: string): Promise<void> {
    const token = ++biomeSearchToken;
    const c = map.getCenter();
    const centerX = Math.round(lngToBlockX(c.lng));
    const centerZ = Math.round(latToBlockZ(c.lat));
    const rings = biomeSearchPlan(centerX, centerZ);
    for (const { ring, patches } of rings) {
      if (token !== biomeSearchToken) return;
      searchPanel.setBiomeStatus(
        `Searching ring ${ring}/${rings.length - 1} for ${biomeId}…`,
      );
      let best: { x: number; z: number; distance: number } | null = null;
      for (const patch of patches) {
        if (token !== biomeSearchToken) return;
        try {
          const response = await ctx.client.biomesGrid({
            dim: state.dim,
            y: state.yLevel,
            ...patch,
          });
          const match = nearestMatchInGrid(patch, response, biomeId, centerX, centerZ);
          if (match && (best === null || match.distance < best.distance)) {
            best = match;
          }
        } catch (err) {
          searchPanel.setBiomeStatus(`Biome search failed: ${errorMessage(err)}`);
          return;
        }
      }
      if (best !== null) {
        const found = best;
        searchPanel.setBiomeResult(biomeId, found.x, found.z, found.distance, () => {
          showResultMarker(found.x, found.z);
          flyToBlock(found.x, found.z);
        });
        showResultMarker(found.x, found.z);
        return;
      }
    }
    if (token === biomeSearchToken) {
      searchPanel.setBiomeStatus(`${biomeId} not found within the search radius (~13 km).`);
    }
  }

  // ---- Shareable hash -----------------------------------------------------
  const scheduleHashUpdate = debounce(() => {
    const c = map.getCenter();
    const hashState: HashState = {
      dim: state.dim,
      x: Math.round(lngToBlockX(c.lng)),
      z: Math.round(latToBlockZ(c.lat)),
      zoom: map.getZoom(),
    };
    const tokens = compactLayerTokens(state.enabled, allStructureIds);
    const withLayers: HashState =
      tokens.length > 0 ? { ...hashState, layers: tokens } : hashState;
    history.replaceState(null, "", location.pathname + location.search + formatHash(withLayers));
  }, 300);

  map.on("moveend", () => {
    refreshMarkers();
    scheduleHashUpdate();
  });
}

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("missing #app root element");
void boot(rootEl);
