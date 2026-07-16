/**
 * `validate locate` — per dimension, N seeded-random origins; for every
 * structure type registered in that dimension, the nearest feature found by an
 * expanding-bbox search over /structures/placed must agree 100% on position
 * with /locate (the game's own ChunkGenerator#locateStructure code path).
 * Both-not-found within the same search radius also counts as agreement.
 */
import { classifyLocateAgreement } from "../core/agreement.js";
import type { XZ, NearestResult } from "../core/nearest.js";
import { boxAround, nearestPlacedFeature, SEARCH_RADII_BLOCKS } from "../core/nearest.js";
import type { LocateResult, OracleClient, PlacedFeature, PlacedLevel } from "../oracle-client.js";
import type { Logger } from "../report.js";
import { deriveRng } from "../rng.js";

export interface LocateOptions {
  /** Random origins per dimension. */
  perDim: number;
  /** Harness PRNG seed — same value, same origins, deterministic runs. */
  seedRng: number;
  /**
   * /structures/placed verification level to compare. biome_ok matches what
   * locateStructure checks (placement grid + biome predicate); start_ok is
   * stricter and slower.
   */
  level: Exclude<PlacedLevel, "grid">;
  /** Origins are drawn uniformly from [-originHalfRange, +originHalfRange]^2. */
  originHalfRange: number;
  radii: readonly number[];
}

export const DEFAULT_LOCATE_OPTIONS: LocateOptions = {
  perDim: 200,
  seedRng: 42,
  level: "biome_ok",
  originHalfRange: 20000,
  radii: SEARCH_RADII_BLOCKS,
};

export interface LocateMismatch {
  dim: string;
  origin: XZ;
  structure: string;
  locate: LocateResult;
  nearest: NearestResult;
  reason: string;
}

export interface LocateSummary {
  dimsChecked: string[];
  typesPerDim: Record<string, number>;
  comparisons: number;
  agreements: number;
  /** Subset of agreements where both sides found nothing in range. */
  bothNotFound: number;
  mismatches: LocateMismatch[];
}

/** Full repro block for one mismatch: origin, both answers, exact curl commands. */
export function formatLocateMismatch(
  client: OracleClient,
  mismatch: LocateMismatch,
  level: Exclude<PlacedLevel, "grid">,
): string {
  const { dim, origin, structure, locate, nearest } = mismatch;
  const locateLine = locate.found
    ? `x=${locate.x} z=${locate.z} distance=${locate.distance.toFixed(1)}`
    : "not_found";
  const nearestLine = nearest.feature
    ? `x=${nearest.feature.x} z=${nearest.feature.z} (searched to r=${nearest.searchedRadius}${nearest.exact ? "" : ", inexact beyond cap"})`
    : `nothing within r=${nearest.searchedRadius}`;
  const placedPath = client.structuresPlacedPath(dim, boxAround(origin, nearest.searchedRadius), {
    types: [structure],
    level,
  });
  return [
    `MISMATCH dim=${dim} origin=(${origin.x}, ${origin.z}) type=${structure}`,
    `  /locate       -> ${locateLine}`,
    `  placed-search -> ${nearestLine}`,
    `  why: ${mismatch.reason}`,
    `  repro:`,
    `    curl "${client.baseUrl}${client.locatePath(dim, origin.x, origin.z, structure)}"`,
    `    curl "${client.baseUrl}${placedPath}"`,
  ].join("\n");
}

export async function runLocateValidation(
  client: OracleClient,
  options: Partial<LocateOptions> = {},
  log: Logger = console.log,
): Promise<LocateSummary> {
  const opts: LocateOptions = { ...DEFAULT_LOCATE_OPTIONS, ...options };
  const meta = await client.meta();
  const registry = await client.registryStructures();
  const dims = [...meta.dimensions].sort();

  const summary: LocateSummary = {
    dimsChecked: [],
    typesPerDim: {},
    comparisons: 0,
    agreements: 0,
    bothNotFound: 0,
    mismatches: [],
  };

  log(
    `validate locate: ${opts.perDim} origins/dim, seed-rng ${opts.seedRng}, level ${opts.level}, ` +
      `origins in [-${opts.originHalfRange}, ${opts.originHalfRange}]^2, search radii ${opts.radii.join("/")}`,
  );

  for (const dim of dims) {
    const types = registry
      .filter((s) => s.dimensions.includes(dim))
      .map((s) => s.id)
      .sort();
    summary.typesPerDim[dim] = types.length;
    if (types.length === 0) {
      log(`  ${dim}: no registered structure types — skipped`);
      continue;
    }
    summary.dimsChecked.push(dim);
    const rng = deriveRng(opts.seedRng, dim);
    for (let i = 0; i < opts.perDim; i++) {
      const origin: XZ = {
        x: rng.int(-opts.originHalfRange, opts.originHalfRange),
        z: rng.int(-opts.originHalfRange, opts.originHalfRange),
      };
      // One /structures/placed query per (origin, radius) shared by all types:
      // the search filters by type client-side.
      const cache = new Map<number, Promise<readonly PlacedFeature[]>>();
      const queryAtRadius = (radius: number): Promise<readonly PlacedFeature[]> => {
        let pending = cache.get(radius);
        if (pending === undefined) {
          pending = client
            .structuresPlaced(dim, boxAround(origin, radius), { level: opts.level })
            .then((res) => res.features);
          cache.set(radius, pending);
        }
        return pending;
      };
      for (const structure of types) {
        const nearest = await nearestPlacedFeature(origin, structure, queryAtRadius, opts.radii);
        const locate = await client.locate(dim, origin.x, origin.z, structure);
        const verdict = classifyLocateAgreement(locate, nearest);
        summary.comparisons += 1;
        if (verdict.agree) {
          summary.agreements += 1;
          if (verdict.kind === "both_not_found") summary.bothNotFound += 1;
        } else {
          const mismatch: LocateMismatch = { dim, origin, structure, locate, nearest, reason: verdict.reason };
          summary.mismatches.push(mismatch);
          log(formatLocateMismatch(client, mismatch, opts.level));
        }
      }
    }
    log(`  ${dim}: ${opts.perDim} origins x ${types.length} types compared`);
  }

  log(
    `validate locate: ${summary.comparisons} comparisons, ${summary.agreements} agreements ` +
      `(${summary.bothNotFound} both-not-found), ${summary.mismatches.length} mismatches`,
  );
  return summary;
}
