#!/usr/bin/env node
/**
 * `validate` — the correctness harness CLI (CLAUDE.md section 5).
 * Exit codes: 0 pass; 1 validation failure; 2 fixture unpopulated/config error.
 */
import os from "node:os";
import { Command, InvalidArgumentError } from "commander";
import { runAll } from "./commands/all.js";
import { GATE_IDS, runGate, type GateId } from "./commands/gates.js";
import { runLocateValidation } from "./commands/locate.js";
import { runSelfConsistency } from "./commands/selfConsistency.js";
import { recordVanillaBaseline, runVanillaBaseline } from "./commands/vanillaBaseline.js";
import { UserError } from "./errors.js";
import { defaultTerralithFixturePath, defaultVanillaFixturePath } from "./fixture-paths.js";
import { OracleClient, type PlacedLevel } from "./oracle-client.js";
import { DEFAULT_ORACLE_URL } from "./pins.js";
import { formatGateReport, gatePassed } from "./report.js";

function parseIntStrict(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError(`not an integer: ${value}`);
  }
  return parsed;
}

function parseLevel(value: string): Exclude<PlacedLevel, "grid"> {
  if (value === "biome_ok" || value === "start_ok") return value;
  throw new InvalidArgumentError(`level must be biome_ok or start_ok, got "${value}"`);
}

function defaultRecordedBy(): string {
  try {
    return `${os.userInfo().username}@${os.hostname()}`;
  } catch {
    return `unknown@${os.hostname()}`;
  }
}

/** Wrap an action: the returned exit code lands in process.exitCode; UserErrors print without a stack. */
function action<A extends unknown[]>(fn: (...args: A) => Promise<number>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      process.exitCode = await fn(...args);
    } catch (err) {
      if (err instanceof UserError) {
        console.error(err.message);
        process.exitCode = err.exitCode;
        return;
      }
      throw err;
    }
  };
}

const program = new Command();
program
  .name("validate")
  .description("Correctness harness for the seedmap oracle: locate, self-consistency, vanilla-baseline, milestone gates.")
  .version("0.1.0");

program
  .command("locate")
  .description(
    "Per dimension, N seeded-random origins: for every registered structure type, the nearest feature from an " +
      "expanding-bbox /structures/placed search must agree 100% on position with /locate (game ground truth).",
  )
  .option("--oracle <url>", "oracle base URL", DEFAULT_ORACLE_URL)
  .option("--per-dim <n>", "random origins per dimension", parseIntStrict, 200)
  .option("--seed-rng <n>", "harness PRNG seed (deterministic runs)", parseIntStrict, 42)
  .option("--level <level>", "placed verification level to compare (biome_ok|start_ok)", parseLevel, "biome_ok")
  .action(
    action(async (opts: { oracle: string; perDim: number; seedRng: number; level: Exclude<PlacedLevel, "grid"> }) => {
      const client = new OracleClient(opts.oracle);
      const summary = await runLocateValidation(client, {
        perDim: opts.perDim,
        seedRng: opts.seedRng,
        level: opts.level,
      });
      return summary.mismatches.length === 0 && summary.comparisons > 0 ? 0 : 1;
    }),
  );

program
  .command("self-consistency")
  .description(
    "Two independently booted oracles (same pack + seed) must answer identically: /meta identity, /registry/*, " +
      "random /biomes/grid byte-equal, random tiles hash-equal, /structures/placed sets equal.",
  )
  .requiredOption("--run-a <url>", "first oracle base URL")
  .requiredOption("--run-b <url>", "second oracle base URL")
  .option("--grids <n>", "random /biomes/grid requests to compare", parseIntStrict, 20)
  .option("--tiles <n>", "random tiles to compare", parseIntStrict, 40)
  .option("--bboxes <n>", "random /structures/placed bboxes to compare", parseIntStrict, 10)
  .option("--seed-rng <n>", "harness PRNG seed (deterministic runs)", parseIntStrict, 42)
  .action(
    action(
      async (opts: { runA: string; runB: string; grids: number; tiles: number; bboxes: number; seedRng: number }) => {
        const result = await runSelfConsistency(new OracleClient(opts.runA), new OracleClient(opts.runB), {
          grids: opts.grids,
          tiles: opts.tiles,
          bboxes: opts.bboxes,
          seedRng: opts.seedRng,
        });
        return result.ok ? 0 : 1;
      },
    ),
  );

program
  .command("vanilla-baseline")
  .description(
    "Compare oracle answers against the committed vanilla 1.21.1 fixture (biomes at fixed coordinates, " +
      "village/stronghold /locate answers for a fixed seed). --record populates the fixture from a running oracle.",
  )
  .option("--oracle <url>", "oracle base URL", DEFAULT_ORACLE_URL)
  .option("--fixture <path>", "fixture file", defaultVanillaFixturePath())
  .option("--record", "query the running oracle and (re)write the fixture", false)
  .option("--recorded-by <who>", "recorded-by stamp for --record", defaultRecordedBy())
  .action(
    action(async (opts: { oracle: string; fixture: string; record: boolean; recordedBy: string }) => {
      const client = new OracleClient(opts.oracle);
      if (opts.record) {
        await recordVanillaBaseline(client, opts.fixture, { recordedBy: opts.recordedBy });
        return 0;
      }
      const outcome = await runVanillaBaseline(client, opts.fixture);
      if (outcome.status === "pass") return 0;
      return outcome.status === "unpopulated" ? 2 : 1;
    }),
  );

program
  .command("all")
  .description("locate + vanilla-baseline (self-consistency excluded: it needs two independently booted oracles).")
  .option("--oracle <url>", "oracle base URL", DEFAULT_ORACLE_URL)
  .option("--fixture <path>", "vanilla baseline fixture file", defaultVanillaFixturePath())
  .option("--per-dim <n>", "random origins per dimension for locate", parseIntStrict, 200)
  .option("--seed-rng <n>", "harness PRNG seed (deterministic runs)", parseIntStrict, 42)
  .option("--level <level>", "placed verification level (biome_ok|start_ok)", parseLevel, "biome_ok")
  .action(
    action(
      async (opts: {
        oracle: string;
        fixture: string;
        perDim: number;
        seedRng: number;
        level: Exclude<PlacedLevel, "grid">;
      }) => {
        return runAll(new OracleClient(opts.oracle), {
          vanillaFixturePath: opts.fixture,
          perDim: opts.perDim,
          seedRng: opts.seedRng,
          level: opts.level,
        });
      },
    ),
  );

program
  .command("gate")
  .description("Milestone gates (CLAUDE.md): prints PASS/FAIL lines suitable for pasting into a PR description.")
  .argument("<milestone>", `one of: ${GATE_IDS.join(", ")}`, (value: string): GateId => {
    if ((GATE_IDS as readonly string[]).includes(value)) return value as GateId;
    throw new InvalidArgumentError(`milestone must be one of ${GATE_IDS.join(", ")}`);
  })
  .option("--oracle <url>", "oracle base URL", DEFAULT_ORACLE_URL)
  .option("--fixture <path>", "override the gate's fixture file (m1: vanilla baseline; m2: terralith coordinate)")
  .option("--record", "m2 only: record the terralith fixture from the running oracle first", false)
  .option("--recorded-by <who>", "recorded-by stamp for --record", defaultRecordedBy())
  .option("--per-dim <n>", "m3 only: random origins per dimension for locate", parseIntStrict, 200)
  .option("--seed-rng <n>", "harness PRNG seed (deterministic runs)", parseIntStrict, 42)
  .option("--level <level>", "m3 only: placed verification level (biome_ok|start_ok)", parseLevel, "biome_ok")
  .action(
    action(
      async (
        milestone: GateId,
        opts: {
          oracle: string;
          fixture?: string;
          record: boolean;
          recordedBy: string;
          perDim: number;
          seedRng: number;
          level: Exclude<PlacedLevel, "grid">;
        },
      ) => {
        const client = new OracleClient(opts.oracle);
        const report = await runGate(milestone, client, {
          vanillaFixturePath: milestone === "m1" && opts.fixture !== undefined ? opts.fixture : defaultVanillaFixturePath(),
          terralithFixturePath:
            milestone === "m2" && opts.fixture !== undefined ? opts.fixture : defaultTerralithFixturePath(),
          record: opts.record,
          recordedBy: opts.recordedBy,
          perDim: opts.perDim,
          seedRng: opts.seedRng,
          level: opts.level,
        });
        console.log(formatGateReport(report));
        return gatePassed(report) ? 0 : 1;
      },
    ),
  );

await program.parseAsync(process.argv);
