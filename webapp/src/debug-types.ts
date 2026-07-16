/** Hooks exposed on window.__seedmap for the Playwright e2e suite. */
export interface SeedmapDebug {
  /** The maplibre Map instance (untyped here to keep e2e deps slim). */
  map: unknown;
  /** True once map + registries are loaded and layers exist. */
  ready: boolean;
  /** Count of oracle tiles fetched successfully via the protocol. */
  tilesLoaded: number;
  /** Feature count of the last /structures/placed refresh (-1 = never ran). */
  lastStructureCount: number;
  /** Rendered structure-marker feature count (queryRenderedFeatures). */
  queryStructureFeatures(): number;
  /** Resolves when the map is idle (all tiles loaded, render settled). */
  onIdle(): Promise<void>;
}

declare global {
  interface Window {
    __seedmap?: SeedmapDebug;
  }
}
