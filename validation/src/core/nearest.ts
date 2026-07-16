/**
 * Nearest-structure search over /structures/placed via an expanding bbox.
 *
 * Strategy (the "radius/bbox strategy" the locate gate depends on):
 * - Query a square bbox of half-width r centered on the origin. A square of
 *   half-width r contains EVERY point at Euclidean distance <= r, so once the
 *   nearest hit inside the box is at distance d <= r it is provably the true
 *   nearest within the search area — nothing closer can be hiding outside.
 * - If the nearest hit sits in a corner (d > r), one more query with
 *   half-width ceil(d) settles it: the new box contains the whole disk of
 *   radius d, so the new minimum d' <= d <= ceil(d) terminates the loop.
 * - The cap MAX_SEARCH_RADIUS_BLOCKS is sized against vanilla /locate:
 *   ChunkGenerator#locateStructure scans a square of +-100 chunks (1600
 *   blocks) around the origin chunk, so the farthest hit it can return is the
 *   square's corner, ~2263 blocks, plus up to a chunk of anchor offset.
 *   2560 covers that with margin, and a bbox of half-width 2560 is 320x320
 *   chunks — under the contract's 512x512-chunk /structures/placed limit, so
 *   every query fits in a single request.
 */
import type { PlacedFeature } from "../oracle-client.js";

export interface XZ {
  x: number;
  z: number;
}

export const SEARCH_RADII_BLOCKS: readonly number[] = [512, 1280, 2560];
export const MAX_SEARCH_RADIUS_BLOCKS = 2560;

export type PlacedQueryAtRadius = (radiusBlocks: number) => Promise<readonly PlacedFeature[]>;

export interface NearestResult {
  feature: PlacedFeature | null;
  /** Largest bbox half-width actually queried, in blocks. */
  searchedRadius: number;
  /**
   * true  => the answer is provably correct within the searched square
   *          (feature is the true nearest, or nothing exists in the square);
   * false => a feature was found only beyond the radius cap's corner region,
   *          so a nearer one just outside the square cannot be ruled out.
   */
  exact: boolean;
}

export function distanceSq(a: XZ, b: XZ): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function boxAround(origin: XZ, radiusBlocks: number): { minX: number; minZ: number; maxX: number; maxZ: number } {
  return {
    minX: origin.x - radiusBlocks,
    minZ: origin.z - radiusBlocks,
    maxX: origin.x + radiusBlocks,
    maxZ: origin.z + radiusBlocks,
  };
}

/** Deterministic nearest pick: min distance, then min x, then min z. */
export function pickNearest(features: readonly PlacedFeature[], origin: XZ): PlacedFeature {
  if (features.length === 0) throw new RangeError("pickNearest on empty feature list");
  let best = features[0]!;
  let bestD = distanceSq(best, origin);
  for (const feature of features.slice(1)) {
    const d = distanceSq(feature, origin);
    if (d < bestD || (d === bestD && (feature.x < best.x || (feature.x === best.x && feature.z < best.z)))) {
      best = feature;
      bestD = d;
    }
  }
  return best;
}

export async function nearestPlacedFeature(
  origin: XZ,
  structureId: string,
  queryAtRadius: PlacedQueryAtRadius,
  radii: readonly number[] = SEARCH_RADII_BLOCKS,
): Promise<NearestResult> {
  if (radii.length === 0) throw new RangeError("empty radius schedule");
  const maxRadius = radii[radii.length - 1]!;
  let scheduleIndex = 0;
  let radius = radii[0]!;
  for (;;) {
    const features = (await queryAtRadius(radius)).filter((f) => f.id === structureId);
    if (features.length === 0) {
      if (radius >= maxRadius) return { feature: null, searchedRadius: radius, exact: true };
      scheduleIndex += 1;
      radius = radii[scheduleIndex] ?? maxRadius;
      continue;
    }
    const best = pickNearest(features, origin);
    const distance = Math.sqrt(distanceSq(best, origin));
    if (distance <= radius) return { feature: best, searchedRadius: radius, exact: true };
    if (radius >= maxRadius) return { feature: best, searchedRadius: radius, exact: false };
    // Corner hit: one more query with half-width ceil(d) settles it (see header).
    radius = Math.min(Math.ceil(distance), maxRadius);
    while (scheduleIndex + 1 < radii.length && radii[scheduleIndex + 1]! <= radius) scheduleIndex += 1;
  }
}
