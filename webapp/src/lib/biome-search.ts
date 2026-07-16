/**
 * Client-side nearest-biome search (M2-acceptable brute force).
 *
 * The world around the origin is partitioned into square "patches" of
 * `patchSamples * stepBlocks` blocks. Patches are visited in expanding
 * Chebyshev rings around the origin patch; each patch becomes one
 * POST /biomes/grid request. Within a ring, patches are ordered by distance
 * of their center to the search origin, and the caller collects the nearest
 * match across the whole ring before stopping — so results are near-optimal
 * (exact within one ring's granularity).
 */

import type { BiomesGridResponse } from "./types";

export interface GridPatch {
  minX: number;
  minZ: number;
  step: number;
  w: number;
  h: number;
}

export interface BiomeSearchRing {
  ring: number;
  patches: GridPatch[];
}

export interface BiomeSearchOptions {
  /** Block distance between samples. Default 32. */
  stepBlocks?: number;
  /** Samples per patch edge. Default 64 (patch = 2048 blocks at defaults). */
  patchSamples?: number;
  /** Rings to search (0 = just the center patch). Default 6 (~13 km). */
  maxRings?: number;
}

export interface BiomeMatch {
  x: number;
  z: number;
  distance: number;
}

/** Build the ring-ordered request plan around a center block position. */
export function biomeSearchPlan(
  centerX: number,
  centerZ: number,
  options: BiomeSearchOptions = {},
): BiomeSearchRing[] {
  const step = options.stepBlocks ?? 32;
  const samples = options.patchSamples ?? 64;
  const maxRings = options.maxRings ?? 6;
  if (step < 1 || samples < 1 || maxRings < 0) {
    throw new RangeError("invalid biome search options");
  }
  const span = step * samples;
  const originX = Math.round(centerX) - Math.floor(span / 2);
  const originZ = Math.round(centerZ) - Math.floor(span / 2);

  const rings: BiomeSearchRing[] = [];
  for (let r = 0; r <= maxRings; r++) {
    const patches: { patch: GridPatch; dist2: number }[] = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const minX = originX + i * span;
        const minZ = originZ + j * span;
        const cx = minX + span / 2;
        const cz = minZ + span / 2;
        patches.push({
          patch: { minX, minZ, step, w: samples, h: samples },
          dist2: (cx - centerX) ** 2 + (cz - centerZ) ** 2,
        });
      }
    }
    patches.sort((a, b) => a.dist2 - b.dist2);
    rings.push({ ring: r, patches: patches.map((p) => p.patch) });
  }
  return rings;
}

/**
 * Scan one /biomes/grid response for the target biome; returns the sample
 * nearest to (centerX, centerZ), or null when absent.
 * Contract: sample (row, col) is block (minX + col*step, minZ + row*step),
 * data is row-major, values index the palette.
 */
export function nearestMatchInGrid(
  patch: GridPatch,
  response: Pick<BiomesGridResponse, "palette" | "data">,
  targetBiome: string,
  centerX: number,
  centerZ: number,
): BiomeMatch | null {
  const targetIndex = response.palette.indexOf(targetBiome);
  if (targetIndex === -1) return null;
  let best: BiomeMatch | null = null;
  const { minX, minZ, step, w } = patch;
  for (let k = 0; k < response.data.length; k++) {
    if (response.data[k] !== targetIndex) continue;
    const row = Math.floor(k / w);
    const col = k % w;
    const x = minX + col * step;
    const z = minZ + row * step;
    const distance = Math.hypot(x - centerX, z - centerZ);
    if (best === null || distance < best.distance) {
      best = { x, z, distance };
    }
  }
  return best;
}
