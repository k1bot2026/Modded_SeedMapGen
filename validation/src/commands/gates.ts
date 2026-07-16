/**
 * `validate gate m0|m1|m2|m3` — machine-checkable milestone gates (CLAUDE.md
 * "Milestones"). Each gate prints PASS/FAIL lines suitable for pasting into a
 * PR description. Cross-platform by construction: these replace shell-script
 * wrappers entirely.
 */
import { readFile, writeFile } from "node:fs/promises";
import { FixtureError, UserError } from "../errors.js";
import { isPng, sha256Hex } from "../core/compare.js";
import { parseTerralithFixture, type PopulatedTerralithFixture, type TerralithFixture } from "../core/fixture.js";
import type { OracleClient, PlacedLevel } from "../oracle-client.js";
import { MC_VERSION, ORACLE_MOD_ID } from "../pins.js";
import type { CheckLine, GateReport, Logger } from "../report.js";
import { runLocateValidation } from "./locate.js";
import { runVanillaBaseline } from "./vanillaBaseline.js";

export type GateId = "m0" | "m1" | "m2" | "m3";

export const GATE_IDS: readonly GateId[] = ["m0", "m1", "m2", "m3"];

export interface GateOptions {
  /** Vanilla baseline fixture (m1). */
  vanillaFixturePath: string;
  /** Terralith coordinate fixture (m2). */
  terralithFixturePath: string;
  /** m2 only: record the terralith fixture from the running oracle first. */
  record: boolean;
  recordedBy: string;
  /** m3 locate run size. */
  perDim: number;
  seedRng: number;
  level: Exclude<PlacedLevel, "grid">;
}

export async function runGate(
  gate: GateId,
  client: OracleClient,
  options: GateOptions,
  log: Logger = console.log,
): Promise<GateReport> {
  switch (gate) {
    case "m0":
      return gateM0(client);
    case "m1":
      return gateM1(client, options.vanillaFixturePath, log);
    case "m2":
      return gateM2(client, options, log);
    case "m3":
      return gateM3(client, options, log);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// m0 — Scaffold: oracle reachable, right MC version, oracle mod present
// ---------------------------------------------------------------------------

async function gateM0(client: OracleClient): Promise<GateReport> {
  const checks: CheckLine[] = [];
  const report: GateReport = { gate: "m0", title: "Scaffold (CLAUDE.md M0)", checks, notes: [] };
  try {
    const meta = await client.meta();
    checks.push({ ok: true, label: `oracle /meta reachable at ${client.baseUrl}` });
    checks.push({
      ok: meta.mcVersion === MC_VERSION,
      label: `mcVersion == "${MC_VERSION}"`,
      detail: `got "${meta.mcVersion}"`,
    });
    const oracleMod = meta.mods.find((mod) => mod.id === ORACLE_MOD_ID);
    checks.push({
      ok: oracleMod !== undefined,
      label: `mod "${ORACLE_MOD_ID}" listed in /meta.mods`,
      detail:
        oracleMod !== undefined
          ? `version ${oracleMod.version}`
          : `mods present: ${meta.mods.map((mod) => mod.id).join(", ") || "(none)"}`,
    });
  } catch (err) {
    checks.push({ ok: false, label: `oracle /meta reachable at ${client.baseUrl}`, detail: errMessage(err) });
  }
  return report;
}

// ---------------------------------------------------------------------------
// m1 — Vanilla biomes: baseline fixture + 5x5 tile viewport served from cache
// ---------------------------------------------------------------------------

export interface TileFetchSample {
  path: string;
  elapsedMs: number;
  xCache: string | null;
  sha256: string;
  isPng: boolean;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Second-pass cache-hit assessment. Preferred signal is an X-Cache header, but
 * the oracle does not send one yet (tracked in docs/oracle-api.md), so we fall
 * back to a timing heuristic: the second-pass median must drop to at most
 * max(30 ms, half of the first-pass median). A warm first pass (median <= 30 ms,
 * e.g. tiles pre-cached by an earlier run) is noted rather than failed.
 */
export function assessCacheHits(
  first: readonly TileFetchSample[],
  second: readonly TileFetchSample[],
): { ok: boolean; method: "x-cache" | "timing"; detail: string } {
  if (second.length > 0 && second.every((tile) => tile.xCache !== null)) {
    const misses = second.filter((tile) => !/hit/i.test(tile.xCache!));
    return {
      ok: misses.length === 0,
      method: "x-cache",
      detail:
        misses.length === 0
          ? "all second-pass responses carry an X-Cache hit header"
          : `${misses.length}/${second.length} second-pass responses report X-Cache "${misses[0]!.xCache!}"`,
    };
  }
  const firstMedian = median(first.map((tile) => tile.elapsedMs));
  const secondMedian = median(second.map((tile) => tile.elapsedMs));
  const threshold = Math.max(30, firstMedian * 0.5);
  const warmFirstPass = firstMedian <= 30;
  return {
    ok: secondMedian <= threshold,
    method: "timing",
    detail:
      `timing heuristic (no X-Cache header): first-pass median ${firstMedian.toFixed(1)} ms, ` +
      `second-pass median ${secondMedian.toFixed(1)} ms, threshold ${threshold.toFixed(1)} ms` +
      (warmFirstPass ? "; first pass was already warm (likely cached by an earlier run)" : ""),
  };
}

export const M1_VIEWPORT = { dim: "minecraft:overworld", y: 64, zoom: 0, half: 2 } as const;

async function fetchViewport(client: OracleClient): Promise<TileFetchSample[]> {
  const samples: TileFetchSample[] = [];
  for (let tx = -M1_VIEWPORT.half; tx <= M1_VIEWPORT.half; tx++) {
    for (let tz = -M1_VIEWPORT.half; tz <= M1_VIEWPORT.half; tz++) {
      const tile = await client.tile(M1_VIEWPORT.dim, M1_VIEWPORT.y, M1_VIEWPORT.zoom, tx, tz);
      samples.push({
        path: tile.path,
        elapsedMs: tile.elapsedMs,
        xCache: tile.xCache,
        sha256: sha256Hex(tile.bytes),
        isPng: isPng(tile.bytes),
      });
    }
  }
  return samples;
}

async function gateM1(client: OracleClient, vanillaFixturePath: string, log: Logger): Promise<GateReport> {
  const checks: CheckLine[] = [];
  const notes: string[] = [];
  const report: GateReport = { gate: "m1", title: "Vanilla biomes (CLAUDE.md M1)", checks, notes };

  try {
    const baseline = await runVanillaBaseline(client, vanillaFixturePath, log);
    checks.push({
      ok: baseline.status === "pass",
      label: "validate vanilla-baseline",
      detail:
        baseline.status === "unpopulated"
          ? `fixture unpopulated — record it first: validate vanilla-baseline --record (${vanillaFixturePath})`
          : `${baseline.checks.filter((c) => c.ok).length}/${baseline.checks.length} fixture checks passed`,
    });
  } catch (err) {
    checks.push({ ok: false, label: "validate vanilla-baseline", detail: errMessage(err) });
  }

  try {
    const first = await fetchViewport(client);
    const second = await fetchViewport(client);
    const allPng = first.every((tile) => tile.isPng) && second.every((tile) => tile.isPng);
    checks.push({
      ok: allPng,
      label: `5x5 tile viewport fetched twice (${M1_VIEWPORT.dim}, y=${M1_VIEWPORT.y}, zoom ${M1_VIEWPORT.zoom})`,
      detail: allPng ? `${first.length + second.length} PNG responses` : "a response was not a PNG",
    });
    const byteIdentical = first.every((tile, i) => tile.sha256 === second[i]!.sha256);
    checks.push({
      ok: byteIdentical,
      label: "second pass byte-identical to first",
      detail: byteIdentical ? "all 25 tile hashes match" : "at least one tile differs between passes",
    });
    const cache = assessCacheHits(first, second);
    checks.push({ ok: cache.ok, label: "second pass served from cache", detail: cache.detail });
    if (cache.method === "timing") {
      notes.push(
        "cache-hit detection uses a timing heuristic because the oracle sends no X-Cache header yet; " +
          "add one to /tiles responses to make this check exact.",
      );
    }
  } catch (err) {
    checks.push({ ok: false, label: "5x5 tile viewport fetch", detail: errMessage(err) });
  }

  return report;
}

// ---------------------------------------------------------------------------
// m2 — Cobbleverse via Modrinth: terralith biomes registered + fixture coord
// ---------------------------------------------------------------------------

async function loadTerralithFixture(fixturePath: string): Promise<TerralithFixture> {
  let text: string;
  try {
    text = await readFile(fixturePath, "utf8");
  } catch (err) {
    throw new FixtureError(`Cannot read fixture ${fixturePath}: ${errMessage(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new FixtureError(`Fixture ${fixturePath} is not valid JSON: ${errMessage(err)}`);
  }
  return parseTerralithFixture(raw, fixturePath);
}

/**
 * `validate gate m2 --record`: scan /biomes/grid around the origin for the
 * first terralith: biome, confirm it via /biome, and write the fixture.
 */
export async function recordTerralithFixture(
  client: OracleClient,
  fixturePath: string,
  recordedBy: string,
  log: Logger,
  scanHalfBlocks = 8192,
): Promise<PopulatedTerralithFixture> {
  const dim = "minecraft:overworld";
  const y = 64;
  const step = 64;
  const size = Math.min(512, Math.floor((2 * scanHalfBlocks) / step));
  const grid = await client.biomesGrid({ dim, y, minX: -scanHalfBlocks, minZ: -scanHalfBlocks, step, w: size, h: size });
  let found: { x: number; z: number } | null = null;
  for (let i = 0; i < grid.data.length; i++) {
    const paletteIndex = grid.data[i]!;
    const id = grid.palette[paletteIndex];
    if (id !== undefined && id.startsWith("terralith:")) {
      const row = Math.floor(i / grid.w);
      const col = i % grid.w;
      found = { x: grid.minX + col * grid.step, z: grid.minZ + row * grid.step };
      break;
    }
  }
  if (found === null) {
    throw new UserError(
      `No terralith: biome found within ±${scanHalfBlocks} blocks of the origin at y=${y}. ` +
        `Is Terralith part of this pack? Increase the scan area or hand-write ${fixturePath}.`,
      2,
    );
  }
  const confirmed = await client.biome(dim, found.x, y, found.z);
  const meta = await client.meta();
  const fixture: PopulatedTerralithFixture = {
    status: "populated",
    dim,
    x: found.x,
    y,
    z: found.z,
    expectedBiome: confirmed.biome,
    recordedBy,
    recordedAt: new Date().toISOString(),
    oracle: { packVersion: meta.packVersion, packFingerprint: meta.packFingerprint },
  };
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
  log(`wrote ${fixturePath}: ${confirmed.biome} at (${found.x}, ${y}, ${found.z}) — commit this file.`);
  return fixture;
}

async function gateM2(client: OracleClient, options: GateOptions, log: Logger): Promise<GateReport> {
  const checks: CheckLine[] = [];
  const notes: string[] = [];
  const report: GateReport = { gate: "m2", title: "Cobbleverse via Modrinth (CLAUDE.md M2)", checks, notes };

  try {
    const biomes = await client.registryBiomes();
    const terralith = biomes.filter((biome) => biome.namespace === "terralith");
    checks.push({
      ok: terralith.length >= 1,
      label: "/registry/biomes contains >=1 terralith: id",
      detail:
        terralith.length >= 1
          ? `${terralith.length} terralith biomes (e.g. ${terralith
              .slice(0, 3)
              .map((biome) => biome.id)
              .join(", ")})`
          : `namespaces present: ${[...new Set(biomes.map((biome) => biome.namespace))].sort().join(", ") || "(none)"}`,
    });
  } catch (err) {
    checks.push({ ok: false, label: "/registry/biomes contains >=1 terralith: id", detail: errMessage(err) });
  }

  try {
    if (options.record) {
      await recordTerralithFixture(client, options.terralithFixturePath, options.recordedBy, log);
    }
    const fixture = await loadTerralithFixture(options.terralithFixturePath);
    if (fixture.status === "unpopulated") {
      checks.push({
        ok: false,
        label: "fixture coordinate answers a terralith: biome",
        detail: `fixture unpopulated — ${fixture.howToPopulate}`,
      });
    } else {
      const answer = await client.biome(fixture.dim, fixture.x, fixture.y, fixture.z);
      const matches = answer.biome === fixture.expectedBiome;
      const isTerralith = answer.biome.startsWith("terralith:");
      checks.push({
        ok: matches && isTerralith,
        label: `fixture coordinate (${fixture.x}, ${fixture.y}, ${fixture.z}) in ${fixture.dim} answers a terralith: biome`,
        detail: matches ? answer.biome : `expected ${fixture.expectedBiome}, got ${answer.biome}`,
      });
    }
  } catch (err) {
    checks.push({ ok: false, label: "fixture coordinate answers a terralith: biome", detail: errMessage(err) });
  }

  return report;
}

// ---------------------------------------------------------------------------
// m3 — Structures: cobbleverse ids registered + locate gate 100%
// ---------------------------------------------------------------------------

async function gateM3(client: OracleClient, options: GateOptions, log: Logger): Promise<GateReport> {
  const checks: CheckLine[] = [];
  const report: GateReport = { gate: "m3", title: "Structures (CLAUDE.md M3)", checks, notes: [] };

  try {
    const structures = await client.registryStructures();
    const cobbleverse = structures.filter((s) => s.namespace === "cobbleverse");
    checks.push({
      ok: cobbleverse.length >= 1,
      label: "/registry/structures contains cobbleverse: ids",
      detail:
        cobbleverse.length >= 1
          ? `${cobbleverse.length} cobbleverse structures (e.g. ${cobbleverse
              .slice(0, 3)
              .map((s) => s.id)
              .join(", ")})`
          : `namespaces present: ${[...new Set(structures.map((s) => s.namespace))].sort().join(", ") || "(none)"}`,
    });
  } catch (err) {
    checks.push({ ok: false, label: "/registry/structures contains cobbleverse: ids", detail: errMessage(err) });
  }

  try {
    const summary = await runLocateValidation(
      client,
      { perDim: options.perDim, seedRng: options.seedRng, level: options.level },
      log,
    );
    checks.push({
      ok: summary.mismatches.length === 0 && summary.comparisons > 0,
      label: "validate locate agrees 100% with /locate",
      detail: `${summary.comparisons} comparisons across ${summary.dimsChecked.length} dimensions, ${summary.mismatches.length} mismatches`,
    });
  } catch (err) {
    checks.push({ ok: false, label: "validate locate agrees 100% with /locate", detail: errMessage(err) });
  }

  return report;
}
