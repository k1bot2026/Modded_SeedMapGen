import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseObservationsFile, verifySeedCommand } from "../src/commands/verifySeed.js";
import { UserError } from "../src/errors.js";
import type { FetchLike } from "../src/io/fetcher.js";

let tmpDir: string;
let obsFile: string;

const OBSERVATIONS = [
  { type: "biome", dim: "minecraft:overworld", x: 0, y: 64, z: 0, expected: "minecraft:plains" },
  { type: "structure", dim: "minecraft:overworld", x: 1424, z: -368, expected: "minecraft:village_plains" },
];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedmap-verify-"));
  obsFile = path.join(tmpDir, "obs.json");
  await writeFile(obsFile, JSON.stringify(OBSERVATIONS));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function oracleRespondingWith(results: unknown[], capture?: { body?: unknown; url?: string }): FetchLike {
  return (url, init) => {
    if (capture) {
      capture.url = url;
      capture.body = JSON.parse(init?.body as string);
    }
    return Promise.resolve(
      new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
}

const match = (seed: string) => ({ seed, matches: 2, total: 2, verdict: "match", details: [] });
const mismatch = (seed: string) => ({
  seed,
  matches: 1,
  total: 2,
  verdict: "mismatch",
  details: [{ index: 1, match: false, actual: null }],
});

const silent = (): void => undefined;

describe("verifySeedCommand exit codes", () => {
  it("exit 0 when EXACTLY ONE candidate fully matches", async () => {
    const code = await verifySeedCommand(
      tmpDir,
      { observations: obsFile, candidates: "1234,-5678", port: "9999" },
      oracleRespondingWith([match("1234"), mismatch("-5678")]),
      silent,
    );
    expect(code).toBe(0);
  });

  it("exit 1 when no candidate matches", async () => {
    const code = await verifySeedCommand(
      tmpDir,
      { observations: obsFile, candidates: "1,2", port: "9999" },
      oracleRespondingWith([mismatch("1"), mismatch("2")]),
      silent,
    );
    expect(code).toBe(1);
  });

  it("exit 1 when MULTIPLE candidates match (ambiguous observations)", async () => {
    const code = await verifySeedCommand(
      tmpDir,
      { observations: obsFile, candidates: "1,2", port: "9999" },
      oracleRespondingWith([match("1"), match("2")]),
      silent,
    );
    expect(code).toBe(1);
  });

  it("sends seeds as JSON strings (64-bit safety) and hits /seed/verify", async () => {
    const capture: { body?: unknown; url?: string } = {};
    await verifySeedCommand(
      tmpDir,
      { observations: obsFile, candidates: "-9223372036854775808", port: "9999" },
      oracleRespondingWith([match("-9223372036854775808")], capture),
      silent,
    );
    expect(capture.url).toBe("http://127.0.0.1:9999/seed/verify");
    expect(capture.body).toEqual({
      candidates: ["-9223372036854775808"],
      observations: OBSERVATIONS,
    });
  });

  it("rejects more than 16 candidates (oracle limit)", async () => {
    const seeds = Array.from({ length: 17 }, (_, i) => String(i)).join(",");
    await expect(
      verifySeedCommand(
        tmpDir,
        { observations: obsFile, candidates: seeds, port: "9999" },
        oracleRespondingWith([]),
        silent,
      ),
    ).rejects.toThrow(/16/);
  });
});

describe("parseObservationsFile", () => {
  it("accepts a bare array or an {observations} wrapper", () => {
    expect(parseObservationsFile(JSON.stringify(OBSERVATIONS))).toHaveLength(2);
    expect(parseObservationsFile(JSON.stringify({ observations: OBSERVATIONS }))).toHaveLength(2);
  });

  it("rejects empty or malformed files", () => {
    expect(() => parseObservationsFile("[]")).toThrow(UserError);
    expect(() => parseObservationsFile("{}")).toThrow(UserError);
    expect(() => parseObservationsFile("not json")).toThrow(/valid JSON/);
  });

  it("rejects more than 256 observations (oracle limit)", () => {
    const many = JSON.stringify(Array.from({ length: 257 }, () => OBSERVATIONS[0]));
    expect(() => parseObservationsFile(many)).toThrow(/256/);
  });
});
