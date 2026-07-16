/**
 * Committed fixture schemas + parsers. Fixtures cannot be generated in a
 * sandbox (they need a booted oracle), so both ship "unpopulated" and every
 * consumer must fail loudly — never silently green — until the owner records
 * them on a machine with a running oracle.
 */
import { FixtureError } from "../errors.js";

// ---------------------------------------------------------------------------
// vanilla-1.21.1 baseline fixture
// ---------------------------------------------------------------------------

export interface FixtureBiomeCheck {
  dim: string;
  x: number;
  y: number;
  z: number;
  /** Biome id the oracle answered at record time. */
  expected: string;
}

export interface FixtureLocateCheck {
  dim: string;
  originX: number;
  originZ: number;
  /** Structure id or #tag, exactly as passed to /locate. */
  structure: string;
  expected: { x: number; z: number } | "not_found";
}

export interface UnpopulatedVanillaFixture {
  status: "unpopulated";
  /** The standard baseline seed; --record boots against this seed. */
  seed: string;
  howToPopulate: string;
}

export interface PopulatedVanillaFixture {
  status: "populated";
  seed: string;
  recordedBy: string;
  /** ISO-8601 timestamp of the recording run. */
  recordedAt: string;
  oracle: {
    mcVersion: string;
    oracleModVersion: string;
    packFingerprint: string;
  };
  biomes: FixtureBiomeCheck[];
  locates: FixtureLocateCheck[];
}

export type VanillaFixture = UnpopulatedVanillaFixture | PopulatedVanillaFixture;

/**
 * Fixed sampling plan used by `validate vanilla-baseline --record`. Points are
 * arbitrary but committed: overworld surface + deep (cave biomes), nether, end.
 */
export const BASELINE_BIOME_POINTS: readonly { dim: string; x: number; y: number; z: number }[] = [
  { dim: "minecraft:overworld", x: 0, y: 64, z: 0 },
  { dim: "minecraft:overworld", x: 512, y: 64, z: -512 },
  { dim: "minecraft:overworld", x: -2048, y: 64, z: 2048 },
  { dim: "minecraft:overworld", x: 4096, y: 64, z: 4096 },
  { dim: "minecraft:overworld", x: -10000, y: 64, z: -10000 },
  { dim: "minecraft:overworld", x: 313, y: -48, z: 542 },
  { dim: "minecraft:overworld", x: -6000, y: -40, z: 6000 },
  { dim: "minecraft:the_nether", x: 0, y: 64, z: 0 },
  { dim: "minecraft:the_nether", x: 1000, y: 64, z: -1000 },
  { dim: "minecraft:the_nether", x: -3000, y: 64, z: 3000 },
  { dim: "minecraft:the_end", x: 0, y: 64, z: 0 },
  { dim: "minecraft:the_end", x: 10000, y: 64, z: 10000 },
];

export const BASELINE_LOCATES: readonly { dim: string; originX: number; originZ: number; structure: string }[] = [
  { dim: "minecraft:overworld", originX: 0, originZ: 0, structure: "#minecraft:village" },
  { dim: "minecraft:overworld", originX: 5000, originZ: -5000, structure: "#minecraft:village" },
  { dim: "minecraft:overworld", originX: -8000, originZ: 3000, structure: "#minecraft:village" },
  { dim: "minecraft:overworld", originX: 0, originZ: 0, structure: "minecraft:stronghold" },
  { dim: "minecraft:overworld", originX: 10000, originZ: 10000, structure: "minecraft:stronghold" },
  { dim: "minecraft:the_nether", originX: 0, originZ: 0, structure: "minecraft:fortress" },
  { dim: "minecraft:the_end", originX: 5000, originZ: 5000, structure: "minecraft:end_city" },
];

function ctxOf(sourcePath: string | undefined): string {
  return sourcePath ?? "fixture";
}

function asRecord(value: unknown, ctx: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FixtureError(`${ctx}: expected a JSON object`);
  }
  return value as Record<string, unknown>;
}

function strField(record: Record<string, unknown>, key: string, ctx: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new FixtureError(`${ctx}: "${key}" must be a non-empty string (got ${typeof value})`);
  }
  return value;
}

function numField(record: Record<string, unknown>, key: string, ctx: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FixtureError(`${ctx}: "${key}" must be a finite number (got ${typeof value})`);
  }
  return value;
}

function arrField(record: Record<string, unknown>, key: string, ctx: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new FixtureError(`${ctx}: "${key}" must be an array`);
  return value;
}

function seedField(record: Record<string, unknown>, ctx: string): string {
  if (typeof record["seed"] === "number") {
    throw new FixtureError(`${ctx}: "seed" must be a JSON string — 64-bit seeds lose precision as numbers`);
  }
  return strField(record, "seed", ctx);
}

export function parseVanillaFixture(raw: unknown, sourcePath?: string): VanillaFixture {
  const ctx = ctxOf(sourcePath);
  const record = asRecord(raw, ctx);
  const status = strField(record, "status", ctx);
  if (status === "unpopulated") {
    return {
      status,
      seed: seedField(record, ctx),
      howToPopulate: strField(record, "howToPopulate", ctx),
    };
  }
  if (status !== "populated") {
    throw new FixtureError(`${ctx}: "status" must be "unpopulated" or "populated" (got "${status}")`);
  }
  const oracleRecord = asRecord(record["oracle"], `${ctx}.oracle`);
  const biomes = arrField(record, "biomes", ctx).map((entry, i) => {
    const e = asRecord(entry, `${ctx}.biomes[${i}]`);
    return {
      dim: strField(e, "dim", `${ctx}.biomes[${i}]`),
      x: numField(e, "x", `${ctx}.biomes[${i}]`),
      y: numField(e, "y", `${ctx}.biomes[${i}]`),
      z: numField(e, "z", `${ctx}.biomes[${i}]`),
      expected: strField(e, "expected", `${ctx}.biomes[${i}]`),
    };
  });
  const locates = arrField(record, "locates", ctx).map((entry, i) => {
    const e = asRecord(entry, `${ctx}.locates[${i}]`);
    const expectedRaw = e["expected"];
    let expected: FixtureLocateCheck["expected"];
    if (expectedRaw === "not_found") {
      expected = "not_found";
    } else {
      const pos = asRecord(expectedRaw, `${ctx}.locates[${i}].expected`);
      expected = {
        x: numField(pos, "x", `${ctx}.locates[${i}].expected`),
        z: numField(pos, "z", `${ctx}.locates[${i}].expected`),
      };
    }
    return {
      dim: strField(e, "dim", `${ctx}.locates[${i}]`),
      originX: numField(e, "originX", `${ctx}.locates[${i}]`),
      originZ: numField(e, "originZ", `${ctx}.locates[${i}]`),
      structure: strField(e, "structure", `${ctx}.locates[${i}]`),
      expected,
    };
  });
  return {
    status,
    seed: seedField(record, ctx),
    recordedBy: strField(record, "recordedBy", ctx),
    recordedAt: strField(record, "recordedAt", ctx),
    oracle: {
      mcVersion: strField(oracleRecord, "mcVersion", `${ctx}.oracle`),
      oracleModVersion: strField(oracleRecord, "oracleModVersion", `${ctx}.oracle`),
      packFingerprint: strField(oracleRecord, "packFingerprint", `${ctx}.oracle`),
    },
    biomes,
    locates,
  };
}

// ---------------------------------------------------------------------------
// terralith-m2 fixture (gate m2 coordinate check)
// ---------------------------------------------------------------------------

export interface UnpopulatedTerralithFixture {
  status: "unpopulated";
  howToPopulate: string;
}

export interface PopulatedTerralithFixture {
  status: "populated";
  dim: string;
  x: number;
  y: number;
  z: number;
  expectedBiome: string;
  recordedBy: string;
  recordedAt: string;
  oracle: {
    packVersion: string;
    packFingerprint: string;
  };
}

export type TerralithFixture = UnpopulatedTerralithFixture | PopulatedTerralithFixture;

export function parseTerralithFixture(raw: unknown, sourcePath?: string): TerralithFixture {
  const ctx = ctxOf(sourcePath);
  const record = asRecord(raw, ctx);
  const status = strField(record, "status", ctx);
  if (status === "unpopulated") {
    return { status, howToPopulate: strField(record, "howToPopulate", ctx) };
  }
  if (status !== "populated") {
    throw new FixtureError(`${ctx}: "status" must be "unpopulated" or "populated" (got "${status}")`);
  }
  const oracleRecord = asRecord(record["oracle"], `${ctx}.oracle`);
  return {
    status,
    dim: strField(record, "dim", ctx),
    x: numField(record, "x", ctx),
    y: numField(record, "y", ctx),
    z: numField(record, "z", ctx),
    expectedBiome: strField(record, "expectedBiome", ctx),
    recordedBy: strField(record, "recordedBy", ctx),
    recordedAt: strField(record, "recordedAt", ctx),
    oracle: {
      packVersion: strField(oracleRecord, "packVersion", `${ctx}.oracle`),
      packFingerprint: strField(oracleRecord, "packFingerprint", `${ctx}.oracle`),
    },
  };
}
