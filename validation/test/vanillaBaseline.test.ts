import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordVanillaBaseline, runVanillaBaseline } from "../src/commands/vanillaBaseline.js";
import { BASELINE_BIOME_POINTS, BASELINE_LOCATES, parseVanillaFixture } from "../src/core/fixture.js";
import { FixtureError } from "../src/errors.js";
import { OracleClient } from "../src/oracle-client.js";
import { errorResponse, fakeOracle, intParam, META, type RouteHandler } from "./helpers.js";

let tmpDir: string;
let fixturePath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedmap-validation-"));
  fixturePath = path.join(tmpDir, "vanilla-1.21.1.json");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const silent = (): void => {};

const POPULATED = {
  status: "populated",
  seed: "1234",
  recordedBy: "owner@mac-mini",
  recordedAt: "2026-07-16T12:00:00.000Z",
  oracle: { mcVersion: "1.21.1", oracleModVersion: "0.1.0", packFingerprint: "sha256:testfingerprint" },
  biomes: [
    { dim: "minecraft:overworld", x: 0, y: 64, z: 0, expected: "minecraft:plains" },
    { dim: "minecraft:the_nether", x: 0, y: 64, z: 0, expected: "minecraft:nether_wastes" },
  ],
  locates: [
    {
      dim: "minecraft:overworld",
      originX: 0,
      originZ: 0,
      structure: "#minecraft:village",
      expected: { x: 100, z: -200 },
    },
    { dim: "minecraft:the_end", originX: 0, originZ: 0, structure: "minecraft:end_city", expected: "not_found" },
  ],
};

function baselineRoutes(overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> {
  return {
    "/meta": () => META,
    "/biome": (url) => ({
      dim: url.searchParams.get("dim"),
      x: intParam(url, "x"),
      y: intParam(url, "y"),
      z: intParam(url, "z"),
      biome: url.searchParams.get("dim") === "minecraft:the_nether" ? "minecraft:nether_wastes" : "minecraft:plains",
    }),
    "/locate": (url) => {
      if (url.searchParams.get("dim") === "minecraft:the_end") {
        return errorResponse("not_found", "nothing in range", 404);
      }
      return { structure: "minecraft:village_plains", x: 100, z: -200, distance: 223.6 };
    },
    ...overrides,
  };
}

describe("runVanillaBaseline", () => {
  it("exits unpopulated with the actionable how-to (never silently green)", async () => {
    await writeFile(fixturePath, JSON.stringify({ status: "unpopulated", seed: "1234", howToPopulate: "boot vanilla and run --record" }));
    const client = new OracleClient("http://o", fakeOracle(baselineRoutes()));
    const outcome = await runVanillaBaseline(client, fixturePath, silent);
    expect(outcome.status).toBe("unpopulated");
    expect(outcome.messages.join("\n")).toContain("boot vanilla and run --record");
    expect(outcome.messages.join("\n")).toContain("UNPOPULATED");
  });

  it("passes when every recorded biome and locate answer matches", async () => {
    await writeFile(fixturePath, JSON.stringify(POPULATED));
    const client = new OracleClient("http://o", fakeOracle(baselineRoutes()));
    const outcome = await runVanillaBaseline(client, fixturePath, silent);
    expect(outcome.status).toBe("pass");
    expect(outcome.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails with expected-vs-got detail on a biome mismatch", async () => {
    await writeFile(fixturePath, JSON.stringify(POPULATED));
    const client = new OracleClient(
      "http://o",
      fakeOracle(
        baselineRoutes({
          "/biome": (url) => ({
            dim: url.searchParams.get("dim"),
            x: intParam(url, "x"),
            y: intParam(url, "y"),
            z: intParam(url, "z"),
            biome: "minecraft:desert",
          }),
        }),
      ),
    );
    const outcome = await runVanillaBaseline(client, fixturePath, silent);
    expect(outcome.status).toBe("fail");
    const failed = outcome.checks.filter((c) => !c.ok);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.detail).toContain("expected minecraft:plains, got minecraft:desert");
  });

  it("fails fast with boot instructions when the oracle runs a different seed", async () => {
    await writeFile(fixturePath, JSON.stringify(POPULATED));
    const client = new OracleClient("http://o", fakeOracle(baselineRoutes({ "/meta": () => ({ ...META, seed: "999" }) })));
    const outcome = await runVanillaBaseline(client, fixturePath, silent);
    expect(outcome.status).toBe("fail");
    expect(outcome.messages.join("\n")).toContain("--seed 1234");
  });

  it("fails when a recorded not_found now resolves to a position", async () => {
    await writeFile(fixturePath, JSON.stringify(POPULATED));
    const client = new OracleClient(
      "http://o",
      fakeOracle(baselineRoutes({ "/locate": () => ({ structure: "x", x: 1, z: 2, distance: 2.2 }) })),
    );
    const outcome = await runVanillaBaseline(client, fixturePath, silent);
    expect(outcome.status).toBe("fail");
    const endCityCheck = outcome.checks.find((c) => c.label.includes("minecraft:end_city"))!;
    expect(endCityCheck.ok).toBe(false);
    expect(endCityCheck.detail).toContain("expected not_found");
  });

  it("throws FixtureError for a missing or malformed fixture", async () => {
    const client = new OracleClient("http://o", fakeOracle(baselineRoutes()));
    await expect(runVanillaBaseline(client, fixturePath, silent)).rejects.toThrow(FixtureError);
    await writeFile(fixturePath, "not json");
    await expect(runVanillaBaseline(client, fixturePath, silent)).rejects.toThrow(FixtureError);
  });
});

describe("recordVanillaBaseline", () => {
  it("writes a populated fixture from the running oracle that then passes comparison", async () => {
    const client = new OracleClient("http://o", fakeOracle(baselineRoutes()));
    const recorded = await recordVanillaBaseline(client, fixturePath, { recordedBy: "tester@ci" }, silent);
    expect(recorded.seed).toBe("1234");
    expect(recorded.biomes).toHaveLength(BASELINE_BIOME_POINTS.length);
    expect(recorded.locates).toHaveLength(BASELINE_LOCATES.length);

    const onDisk = parseVanillaFixture(JSON.parse(await readFile(fixturePath, "utf8")), fixturePath);
    expect(onDisk.status).toBe("populated");
    if (onDisk.status === "populated") {
      expect(onDisk.recordedBy).toBe("tester@ci");
      expect(onDisk.oracle.packFingerprint).toBe(META.packFingerprint);
      expect(onDisk.locates.find((l) => l.dim === "minecraft:the_end")!.expected).toBe("not_found");
    }

    const outcome = await runVanillaBaseline(client, fixturePath, silent);
    expect(outcome.status).toBe("pass");
  });

  it("warns when re-recording changes the standard seed", async () => {
    await writeFile(fixturePath, JSON.stringify({ status: "unpopulated", seed: "42", howToPopulate: "x" }));
    const lines: string[] = [];
    const client = new OracleClient("http://o", fakeOracle(baselineRoutes()));
    await recordVanillaBaseline(client, fixturePath, { recordedBy: "tester@ci" }, (line) => lines.push(line));
    expect(lines.join("\n")).toContain('existing fixture used seed "42"');
  });
});
