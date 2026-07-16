import type { OverlayDiffEntry } from "./overlay.js";

/**
 * config/seedmap-oracle.json, exactly per docs/oracle-api.md. `dimensions` is
 * an optional advisory extension (from `seedmap run --dim ...`); the oracle
 * ignores unknown fields.
 */
export interface OracleConfig {
  port: number;
  packName: string;
  packVersion: string;
  packFingerprint: string;
  cacheDir: string;
  overlayDiff: OverlayDiffEntry[];
  dimensions?: string[];
}

export function buildOracleConfig(opts: {
  port: number;
  packName: string;
  packVersion: string;
  packFingerprint: string;
  cacheDir: string;
  overlayDiff: OverlayDiffEntry[];
  dimensions?: string[];
}): OracleConfig {
  const config: OracleConfig = {
    port: opts.port,
    packName: opts.packName,
    packVersion: opts.packVersion,
    packFingerprint: opts.packFingerprint,
    cacheDir: opts.cacheDir,
    overlayDiff: opts.overlayDiff,
  };
  if (opts.dimensions !== undefined && opts.dimensions.length > 0) {
    config.dimensions = opts.dimensions;
  }
  return config;
}
