/**
 * `validate vanilla-baseline` — compare a running oracle against the committed
 * fixtures/vanilla-1.21.1.json (biomes at fixed coordinates + /locate answers
 * for a fixed seed). The fixture ships "unpopulated" because it can only be
 * recorded against a booted oracle; the compare path then exits with an
 * actionable message (exit code 2) so the gate is honest, never silently green.
 */
import { readFile, writeFile } from "node:fs/promises";
import { FixtureError } from "../errors.js";
import {
  BASELINE_BIOME_POINTS,
  BASELINE_LOCATES,
  parseVanillaFixture,
  type FixtureBiomeCheck,
  type FixtureLocateCheck,
  type PopulatedVanillaFixture,
  type VanillaFixture,
} from "../core/fixture.js";
import type { OracleClient } from "../oracle-client.js";
import { formatCheckLine, type CheckLine, type Logger } from "../report.js";

export type BaselineStatus = "pass" | "fail" | "unpopulated";

export interface BaselineOutcome {
  status: BaselineStatus;
  checks: CheckLine[];
  messages: string[];
}

export async function loadVanillaFixture(fixturePath: string): Promise<VanillaFixture> {
  let text: string;
  try {
    text = await readFile(fixturePath, "utf8");
  } catch (err) {
    throw new FixtureError(
      `Cannot read fixture ${fixturePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new FixtureError(
      `Fixture ${fixturePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseVanillaFixture(raw, fixturePath);
}

function unpopulatedOutcome(fixturePath: string, seed: string, howToPopulate: string): BaselineOutcome {
  return {
    status: "unpopulated",
    checks: [],
    messages: [
      `vanilla-baseline: fixture ${fixturePath} is UNPOPULATED — this gate cannot pass yet.`,
      `Standard baseline seed: ${seed}`,
      `How to populate: ${howToPopulate}`,
      `Then commit the rewritten fixture; from that point on this command compares for real.`,
    ],
  };
}

export async function runVanillaBaseline(
  client: OracleClient,
  fixturePath: string,
  log: Logger = console.log,
): Promise<BaselineOutcome> {
  const fixture = await loadVanillaFixture(fixturePath);
  if (fixture.status === "unpopulated") {
    const outcome = unpopulatedOutcome(fixturePath, fixture.seed, fixture.howToPopulate);
    for (const message of outcome.messages) log(message);
    return outcome;
  }

  const meta = await client.meta();
  const preconditions: CheckLine[] = [
    {
      ok: meta.seed === fixture.seed,
      label: "oracle seed matches fixture",
      detail: `oracle "${meta.seed}", fixture "${fixture.seed}"`,
    },
    {
      ok: meta.mcVersion === fixture.oracle.mcVersion,
      label: "oracle mcVersion matches fixture",
      detail: `oracle "${meta.mcVersion}", fixture "${fixture.oracle.mcVersion}"`,
    },
  ];
  for (const check of preconditions) log(formatCheckLine(check));
  if (preconditions.some((c) => !c.ok)) {
    const messages = [
      `vanilla-baseline: preconditions failed — boot the oracle with --seed ${fixture.seed} on vanilla ${fixture.oracle.mcVersion} and retry.`,
    ];
    for (const message of messages) log(message);
    return { status: "fail", checks: preconditions, messages };
  }

  const messages: string[] = [];
  if (meta.packFingerprint !== fixture.oracle.packFingerprint) {
    // Informational: a rebuilt oracle mod changes the fingerprint while every
    // worldgen answer must stay identical — that is exactly what we verify.
    messages.push(
      `note: packFingerprint differs from recording (oracle ${meta.packFingerprint}, fixture ${fixture.oracle.packFingerprint}) — comparing worldgen answers anyway.`,
    );
    for (const message of messages) log(message);
  }

  const checks: CheckLine[] = [...preconditions];
  for (const point of fixture.biomes) {
    const answer = await client.biome(point.dim, point.x, point.y, point.z);
    checks.push({
      ok: answer.biome === point.expected,
      label: `biome ${point.dim} (${point.x}, ${point.y}, ${point.z})`,
      detail: answer.biome === point.expected ? point.expected : `expected ${point.expected}, got ${answer.biome}`,
    });
    log(formatCheckLine(checks[checks.length - 1]!));
  }
  for (const check of fixture.locates) {
    const result = await client.locate(check.dim, check.originX, check.originZ, check.structure);
    checks.push(compareLocate(check, result));
    log(formatCheckLine(checks[checks.length - 1]!));
  }

  const failed = checks.filter((c) => !c.ok).length;
  const status: BaselineStatus = failed === 0 ? "pass" : "fail";
  log(`vanilla-baseline: ${status.toUpperCase()} (${checks.length - failed}/${checks.length} checks)`);
  return { status, checks, messages };
}

function compareLocate(
  check: FixtureLocateCheck,
  result: { found: true; x: number; z: number } | { found: false },
): CheckLine {
  const label = `locate ${check.structure} from (${check.originX}, ${check.originZ}) in ${check.dim}`;
  if (check.expected === "not_found") {
    return {
      ok: !result.found,
      label,
      detail: result.found ? `expected not_found, got (${result.x}, ${result.z})` : "not_found as recorded",
    };
  }
  if (!result.found) {
    return { ok: false, label, detail: `expected (${check.expected.x}, ${check.expected.z}), got not_found` };
  }
  const ok = result.x === check.expected.x && result.z === check.expected.z;
  return {
    ok,
    label,
    detail: ok
      ? `(${result.x}, ${result.z})`
      : `expected (${check.expected.x}, ${check.expected.z}), got (${result.x}, ${result.z})`,
  };
}

export interface RecordOptions {
  recordedBy: string;
}

/**
 * `validate vanilla-baseline --record` — query the running oracle at the
 * committed sampling plan and (re)write the fixture. The owner runs this once
 * against a fresh vanilla run and commits the result.
 */
export async function recordVanillaBaseline(
  client: OracleClient,
  fixturePath: string,
  options: RecordOptions,
  log: Logger = console.log,
): Promise<PopulatedVanillaFixture> {
  const meta = await client.meta();

  let previousSeed: string | null = null;
  try {
    previousSeed = (await loadVanillaFixture(fixturePath)).seed;
  } catch {
    // No readable previous fixture — fine, we are creating it.
  }
  if (previousSeed !== null && previousSeed !== meta.seed) {
    log(
      `warning: recording with oracle seed "${meta.seed}" but the existing fixture used seed "${previousSeed}" — the standard baseline seed is changing.`,
    );
  }

  const biomes: FixtureBiomeCheck[] = [];
  for (const point of BASELINE_BIOME_POINTS) {
    if (!meta.dimensions.includes(point.dim)) {
      log(`warning: dimension ${point.dim} not registered on this oracle — skipping biome point`);
      continue;
    }
    const answer = await client.biome(point.dim, point.x, point.y, point.z);
    biomes.push({ dim: point.dim, x: point.x, y: point.y, z: point.z, expected: answer.biome });
    log(`recorded biome ${point.dim} (${point.x}, ${point.y}, ${point.z}) = ${answer.biome}`);
  }

  const locates: FixtureLocateCheck[] = [];
  for (const plan of BASELINE_LOCATES) {
    if (!meta.dimensions.includes(plan.dim)) {
      log(`warning: dimension ${plan.dim} not registered on this oracle — skipping locate`);
      continue;
    }
    const result = await client.locate(plan.dim, plan.originX, plan.originZ, plan.structure);
    const expected = result.found ? { x: result.x, z: result.z } : ("not_found" as const);
    locates.push({ ...plan, expected });
    log(
      `recorded locate ${plan.structure} from (${plan.originX}, ${plan.originZ}) in ${plan.dim} = ` +
        (result.found ? `(${result.x}, ${result.z})` : "not_found"),
    );
  }

  const fixture: PopulatedVanillaFixture = {
    status: "populated",
    seed: meta.seed,
    recordedBy: options.recordedBy,
    recordedAt: new Date().toISOString(),
    oracle: {
      mcVersion: meta.mcVersion,
      oracleModVersion: meta.oracleModVersion,
      packFingerprint: meta.packFingerprint,
    },
    biomes,
    locates,
  };
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
  log(`wrote ${fixturePath} (${biomes.length} biome points, ${locates.length} locates) — commit this file.`);
  return fixture;
}
