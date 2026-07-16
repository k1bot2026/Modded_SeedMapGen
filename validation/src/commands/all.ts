/**
 * `validate all` — locate + vanilla-baseline. self-consistency is deliberately
 * excluded: it needs two independently booted oracles (--run-a/--run-b), which
 * a single `validate all` invocation cannot provide.
 */
import type { OracleClient, PlacedLevel } from "../oracle-client.js";
import type { Logger } from "../report.js";
import { runLocateValidation } from "./locate.js";
import { runVanillaBaseline } from "./vanillaBaseline.js";

export interface AllOptions {
  vanillaFixturePath: string;
  perDim: number;
  seedRng: number;
  level: Exclude<PlacedLevel, "grid">;
}

/** Exit code: 0 all green; 1 any validation failure; 2 only the fixture is unpopulated. */
export async function runAll(client: OracleClient, options: AllOptions, log: Logger = console.log): Promise<number> {
  log("validate all — running: locate, vanilla-baseline");
  log(
    "note: self-consistency is excluded (it needs two independently booted oracles); " +
      "run it explicitly: validate self-consistency --run-a <url> --run-b <url>",
  );

  const summary = await runLocateValidation(
    client,
    { perDim: options.perDim, seedRng: options.seedRng, level: options.level },
    log,
  );
  const baseline = await runVanillaBaseline(client, options.vanillaFixturePath, log);

  const locateOk = summary.mismatches.length === 0;
  log("");
  log(`validate all: locate ${locateOk ? "PASS" : `FAIL (${summary.mismatches.length} mismatches)`}, vanilla-baseline ${baseline.status.toUpperCase()}`);
  if (!locateOk || baseline.status === "fail") return 1;
  if (baseline.status === "unpopulated") return 2;
  return 0;
}
