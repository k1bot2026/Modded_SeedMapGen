/**
 * `validate self-consistency` — two independently booted oracles for the same
 * pack + seed must be indistinguishable: /meta identity fields, /registry/*,
 * random /biomes/grid responses (byte-equal), random tile PNGs (hash-equal)
 * and /structures/placed sets on random bboxes. Guards nondeterminism and
 * threading bugs. Stops at the first divergence and reports it precisely.
 */
import { firstByteDivergence, firstJsonDifference, sha256Hex } from "../core/compare.js";
import type { OracleClient, OracleMeta, PlacedFeature } from "../oracle-client.js";
import type { Logger } from "../report.js";
import { createRng } from "../rng.js";

export interface SelfConsistencyOptions {
  /** Number of random /biomes/grid requests compared byte-for-byte. */
  grids: number;
  /** Number of random tiles compared by sha256. */
  tiles: number;
  /** Number of random /structures/placed bboxes compared as sets. */
  bboxes: number;
  seedRng: number;
}

export const DEFAULT_SELF_CONSISTENCY_OPTIONS: SelfConsistencyOptions = {
  grids: 20,
  tiles: 40,
  bboxes: 10,
  seedRng: 42,
};

export interface Divergence {
  where: string;
  detail: string;
}

export interface SelfConsistencyResult {
  ok: boolean;
  checksRun: number;
  divergence: Divergence | null;
}

/** Identity projection of /meta — every field two same-pack boots must share. */
function metaProjection(meta: OracleMeta): Record<string, unknown> {
  return {
    mcVersion: meta.mcVersion,
    loaderVersion: meta.loaderVersion,
    oracleModVersion: meta.oracleModVersion,
    seed: meta.seed,
    packName: meta.packName,
    packVersion: meta.packVersion,
    packFingerprint: meta.packFingerprint,
    dimensions: [...meta.dimensions].sort(),
    overlayDiff: meta.overlayDiff,
    mods: [...meta.mods].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function sortFeatures(features: readonly PlacedFeature[]): PlacedFeature[] {
  return [...features].sort(
    (a, b) => a.id.localeCompare(b.id) || a.x - b.x || a.z - b.z || a.structureSet.localeCompare(b.structureSet),
  );
}

export async function runSelfConsistency(
  a: OracleClient,
  b: OracleClient,
  options: Partial<SelfConsistencyOptions> = {},
  log: Logger = console.log,
): Promise<SelfConsistencyResult> {
  const opts: SelfConsistencyOptions = { ...DEFAULT_SELF_CONSISTENCY_OPTIONS, ...options };
  let checksRun = 0;
  const diverged = (where: string, detail: string): SelfConsistencyResult => {
    log(`DIVERGENCE at ${where}`);
    log(`  ${detail}`);
    log(`self-consistency: FAIL after ${checksRun} checks`);
    return { ok: false, checksRun, divergence: { where, detail } };
  };

  log(`self-consistency: A=${a.baseUrl} B=${b.baseUrl} (grids=${opts.grids}, tiles=${opts.tiles}, bboxes=${opts.bboxes}, seed-rng=${opts.seedRng})`);

  const [metaA, metaB] = await Promise.all([a.meta(), b.meta()]);
  checksRun += 1;
  const metaDiff = firstJsonDifference(metaProjection(metaA), metaProjection(metaB));
  if (metaDiff !== null) return diverged("/meta", metaDiff);
  log(`  /meta identical: fingerprint ${metaA.packFingerprint}, seed "${metaA.seed}"`);

  const [structsA, structsB] = await Promise.all([a.registryStructures(), b.registryStructures()]);
  checksRun += 1;
  const sortById = <T extends { id: string }>(items: readonly T[]): T[] =>
    [...items].sort((x, y) => x.id.localeCompare(y.id));
  const structsDiff = firstJsonDifference(sortById(structsA), sortById(structsB));
  if (structsDiff !== null) return diverged("/registry/structures", structsDiff);

  const [biomesA, biomesB] = await Promise.all([a.registryBiomes(), b.registryBiomes()]);
  checksRun += 1;
  const biomesDiff = firstJsonDifference(sortById(biomesA), sortById(biomesB));
  if (biomesDiff !== null) return diverged("/registry/biomes", biomesDiff);
  log(`  /registry/structures (${structsA.length}) and /registry/biomes (${biomesA.length}) identical`);

  const dims = [...metaA.dimensions].sort();
  const rng = createRng(opts.seedRng);

  for (let i = 0; i < opts.grids; i++) {
    const request = {
      dim: rng.pick(dims),
      y: rng.pick([-48, 0, 64, 128]),
      minX: rng.int(-16384, 16384),
      minZ: rng.int(-16384, 16384),
      step: rng.pick([1, 4, 16]),
      w: 64,
      h: 64,
    };
    const [gridA, gridB] = await Promise.all([a.biomesGridRaw(request), b.biomesGridRaw(request)]);
    checksRun += 1;
    const divergence = firstByteDivergence(gridA.bytes, gridB.bytes);
    if (divergence !== null) {
      return diverged(
        `/biomes/grid ${JSON.stringify(request)}`,
        `first differing byte at index ${divergence.index} (A=${divergence.a ?? "EOF"}, B=${divergence.b ?? "EOF"}); ` +
          `sha256 A=${sha256Hex(gridA.bytes)} B=${sha256Hex(gridB.bytes)}`,
      );
    }
  }
  log(`  ${opts.grids} random /biomes/grid responses byte-identical`);

  for (let i = 0; i < opts.tiles; i++) {
    const dim = rng.pick(dims);
    const y = rng.pick([-48, 64]);
    const zoom = rng.int(0, 3);
    const tileHalf = Math.max(1, 16 >> zoom);
    const tx = rng.int(-tileHalf, tileHalf);
    const tz = rng.int(-tileHalf, tileHalf);
    const [tileA, tileB] = await Promise.all([a.tile(dim, y, zoom, tx, tz), b.tile(dim, y, zoom, tx, tz)]);
    checksRun += 1;
    const hashA = sha256Hex(tileA.bytes);
    const hashB = sha256Hex(tileB.bytes);
    if (hashA !== hashB) {
      return diverged(`tile ${tileA.path}`, `png bytes differ: sha256 A=${hashA} B=${hashB}`);
    }
  }
  log(`  ${opts.tiles} random tile PNGs hash-identical`);

  for (let i = 0; i < opts.bboxes; i++) {
    const dim = rng.pick(dims);
    const centerX = rng.int(-16384, 16384);
    const centerZ = rng.int(-16384, 16384);
    const half = 1024;
    const box = { minX: centerX - half, minZ: centerZ - half, maxX: centerX + half, maxZ: centerZ + half };
    const [placedA, placedB] = await Promise.all([
      a.structuresPlaced(dim, box, { level: "biome_ok" }),
      b.structuresPlaced(dim, box, { level: "biome_ok" }),
    ]);
    checksRun += 1;
    const placedDiff = firstJsonDifference(sortFeatures(placedA.features), sortFeatures(placedB.features));
    if (placedDiff !== null) {
      return diverged(`/structures/placed dim=${dim} bbox=(${box.minX},${box.minZ})..(${box.maxX},${box.maxZ})`, placedDiff);
    }
  }
  log(`  ${opts.bboxes} random /structures/placed sets identical`);

  log(`self-consistency: PASS (${checksRun} checks, no divergence)`);
  return { ok: true, checksRun, divergence: null };
}
