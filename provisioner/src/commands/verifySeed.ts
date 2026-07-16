import { readFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.js";
import { DEFAULT_ORACLE_PORT } from "../pins.js";
import { parseSeedList } from "../core/seed.js";
import type { FetchLike } from "../io/fetcher.js";
import { readTextIfExists } from "../io/fsx.js";
import type { Logger } from "../util.js";

export interface VerifySeedOptions {
  observations: string;
  candidates: string;
  port?: string;
}

interface VerifyDetail {
  index: number;
  match: boolean | null;
  actual?: unknown;
  unsupported?: boolean;
}

interface VerifyResult {
  seed: string;
  matches: number;
  total: number;
  verdict: "match" | "mismatch";
  details: VerifyDetail[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Accepts either a bare observations array or {observations: [...]}. */
export function parseObservationsFile(raw: string): unknown[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new UserError(`Observations file is not valid JSON: ${(err as Error).message}`);
  }
  const observations = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.observations)
      ? json.observations
      : null;
  if (observations === null || observations.length === 0) {
    throw new UserError(
      'Observations file must be a JSON array of observations (or {"observations": [...]}), and non-empty.',
    );
  }
  if (observations.length > 256) {
    throw new UserError(`Too many observations (${observations.length} > 256, oracle limit).`);
  }
  return observations;
}

async function resolvePort(runDir: string, rawPort: string | undefined): Promise<number> {
  if (rawPort !== undefined) {
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new UserError(`Invalid --port ${rawPort}.`);
    }
    return port;
  }
  const raw = await readTextIfExists(path.join(runDir, "server", "config", "seedmap-oracle.json"));
  if (raw !== null) {
    try {
      const config: unknown = JSON.parse(raw);
      if (isRecord(config) && typeof config.port === "number") return config.port;
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_ORACLE_PORT;
}

function describeObservation(obs: unknown): string {
  if (!isRecord(obs)) return JSON.stringify(obs);
  const type = typeof obs.type === "string" ? obs.type : "?";
  const dim = typeof obs.dim === "string" ? obs.dim : "?";
  const coords =
    obs.y !== undefined ? `(${obs.x as number}, ${obs.y as number}, ${obs.z as number})` : `(${obs.x as number}, ${obs.z as number})`;
  const expected = typeof obs.expected === "string" ? obs.expected : JSON.stringify(obs.expected);
  return `${type} ${coords} ${dim} expected ${expected}`;
}

/**
 * `seedmap verify-seed <runDir> --observations obs.json --candidates <seed,...>`
 * POSTs /seed/verify to the running oracle and pretty-prints the report.
 * Exit code 0 only when EXACTLY ONE candidate fully matches.
 */
export async function verifySeedCommand(
  runDirRef: string,
  opts: VerifySeedOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<number> {
  const candidates = parseSeedList(opts.candidates);
  if (candidates.length > 16) {
    throw new UserError(`Too many candidates (${candidates.length} > 16, oracle limit).`);
  }
  const observations = parseObservationsFile(await readFile(opts.observations, "utf8"));
  const port = await resolvePort(path.resolve(runDirRef), opts.port);
  const url = `http://127.0.0.1:${port}/seed/verify`;

  log(`POST ${url} — ${candidates.length} candidate(s), ${observations.length} observation(s)`);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates, observations }),
    });
  } catch (err) {
    throw new UserError(
      `Could not reach the oracle at ${url} (${(err as Error).message}).\n` +
        `Is \`seedmap run ${runDirRef}\` running?`,
    );
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new UserError(`Oracle answered HTTP ${res.status} for /seed/verify: ${body}`);
  }
  const json: unknown = await res.json();
  if (!isRecord(json) || !Array.isArray(json.results)) {
    throw new UserError("Unexpected /seed/verify response shape.");
  }
  const results = json.results as VerifyResult[];

  log("");
  let fullMatches = 0;
  for (const result of results) {
    const flag = result.verdict === "match" ? "MATCH   " : "mismatch";
    log(`Seed ${result.seed.padEnd(21)} ${flag}  ${result.matches}/${result.total}`);
    for (const detail of result.details ?? []) {
      const obs = observations[detail.index];
      if (detail.unsupported === true) {
        log(`  [${detail.index}] ${describeObservation(obs)} -> unsupported (excluded)`);
      } else if (detail.match !== true) {
        const actual = detail.actual === undefined ? "none" : JSON.stringify(detail.actual);
        log(`  [${detail.index}] ${describeObservation(obs)} -> actual ${actual} (FAIL)`);
      }
    }
    if (result.verdict === "match") fullMatches += 1;
  }

  log("");
  if (fullMatches === 1) {
    const winner = results.find((r) => r.verdict === "match")!;
    log(`Exactly one candidate fully matches: ${winner.seed}`);
    return 0;
  }
  log(
    fullMatches === 0
      ? "No candidate fully matches the observations."
      : `${fullMatches} candidates fully match — observations cannot distinguish them.`,
  );
  return 1;
}
