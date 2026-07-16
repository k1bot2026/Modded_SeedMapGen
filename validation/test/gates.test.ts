import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordTerralithFixture, runGate, type GateOptions } from "../src/commands/gates.js";
import { parseTerralithFixture } from "../src/core/fixture.js";
import { OracleClient } from "../src/oracle-client.js";
import { formatGateReport, gatePassed } from "../src/report.js";
import { fakeOracle, feature, intParam, META, pngBytes, pngResponse, type RouteHandler } from "./helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedmap-gates-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const silent = (): void => {};

function gateOptions(overrides: Partial<GateOptions> = {}): GateOptions {
  return {
    vanillaFixturePath: path.join(tmpDir, "vanilla.json"),
    terralithFixturePath: path.join(tmpDir, "terralith.json"),
    record: false,
    recordedBy: "tester@ci",
    perDim: 2,
    seedRng: 42,
    level: "biome_ok",
    ...overrides,
  };
}

describe("gate m0", () => {
  it("passes on a reachable 1.21.1 oracle with the seedmap-oracle mod", async () => {
    const client = new OracleClient("http://o", fakeOracle({ "/meta": () => META }));
    const report = await runGate("m0", client, gateOptions(), silent);
    expect(gatePassed(report)).toBe(true);
    const text = formatGateReport(report);
    expect(text).toContain('[PASS] mcVersion == "1.21.1"');
    expect(text).toContain('[PASS] mod "seedmap-oracle" listed');
    expect(text).toContain("RESULT: PASS (3/3 checks)");
  });

  it("fails on the wrong MC version and on a missing oracle mod", async () => {
    const client = new OracleClient(
      "http://o",
      fakeOracle({ "/meta": () => ({ ...META, mcVersion: "1.20.4", mods: [META.mods[0]] }) }),
    );
    const report = await runGate("m0", client, gateOptions(), silent);
    expect(gatePassed(report)).toBe(false);
    const text = formatGateReport(report);
    expect(text).toContain('[FAIL] mcVersion == "1.21.1" — got "1.20.4"');
    expect(text).toContain('[FAIL] mod "seedmap-oracle"');
  });

  it("fails with a single reachability check when the oracle is down", async () => {
    const client = new OracleClient("http://o", () => Promise.reject(new Error("ECONNREFUSED")));
    const report = await runGate("m0", client, gateOptions(), silent);
    expect(gatePassed(report)).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]!.detail).toContain("ECONNREFUSED");
  });
});

const M1_POPULATED = {
  status: "populated",
  seed: "1234",
  recordedBy: "owner",
  recordedAt: "2026-07-16T12:00:00.000Z",
  oracle: { mcVersion: "1.21.1", oracleModVersion: "0.1.0", packFingerprint: "sha256:testfingerprint" },
  biomes: [{ dim: "minecraft:overworld", x: 0, y: 64, z: 0, expected: "minecraft:plains" }],
  locates: [
    { dim: "minecraft:overworld", originX: 0, originZ: 0, structure: "#minecraft:village", expected: { x: 100, z: -200 } },
  ],
};

function m1Routes(): Record<string, RouteHandler> {
  return {
    "/meta": () => META,
    "/biome": (url) => ({
      dim: url.searchParams.get("dim"),
      x: intParam(url, "x"),
      y: intParam(url, "y"),
      z: intParam(url, "z"),
      biome: "minecraft:plains",
    }),
    "/locate": () => ({ structure: "minecraft:village_plains", x: 100, z: -200, distance: 223.6 }),
    "/tiles/*": (url) => pngResponse(pngBytes(url.pathname)),
  };
}

describe("gate m1", () => {
  it("passes with a populated fixture and deterministic tiles; notes the timing heuristic", async () => {
    const options = gateOptions();
    await writeFile(options.vanillaFixturePath, JSON.stringify(M1_POPULATED));
    const client = new OracleClient("http://o", fakeOracle(m1Routes()));
    const report = await runGate("m1", client, options, silent);
    expect(gatePassed(report)).toBe(true);
    expect(report.notes.join(" ")).toContain("timing heuristic");
    const text = formatGateReport(report);
    expect(text).toContain("[PASS] second pass byte-identical to first");
  });

  it("fails honestly while the fixture is unpopulated", async () => {
    const options = gateOptions();
    await writeFile(
      options.vanillaFixturePath,
      JSON.stringify({ status: "unpopulated", seed: "1234", howToPopulate: "record me" }),
    );
    const client = new OracleClient("http://o", fakeOracle(m1Routes()));
    const report = await runGate("m1", client, options, silent);
    expect(gatePassed(report)).toBe(false);
    const baselineCheck = report.checks.find((c) => c.label === "validate vanilla-baseline")!;
    expect(baselineCheck.ok).toBe(false);
    expect(baselineCheck.detail).toContain("--record");
  });

  it("fails when a tile response is not a PNG", async () => {
    const options = gateOptions();
    await writeFile(options.vanillaFixturePath, JSON.stringify(M1_POPULATED));
    const routes = m1Routes();
    routes["/tiles/*"] = () => new Response("not a png", { status: 200 });
    const client = new OracleClient("http://o", fakeOracle(routes));
    const report = await runGate("m1", client, options, silent);
    expect(gatePassed(report)).toBe(false);
  });
});

const TERRALITH_BIOMES = {
  biomes: [
    { id: "minecraft:plains", namespace: "minecraft", color: "#8db360" },
    { id: "terralith:alpine_grove", namespace: "terralith", color: "#6a9f4b" },
  ],
};

function m2Routes(): Record<string, RouteHandler> {
  return {
    "/meta": () => META,
    "/registry/biomes": () => TERRALITH_BIOMES,
    "/biome": (url) => ({
      dim: url.searchParams.get("dim"),
      x: intParam(url, "x"),
      y: intParam(url, "y"),
      z: intParam(url, "z"),
      // terralith east of x=1000, plains elsewhere
      biome: intParam(url, "x") >= 1000 ? "terralith:alpine_grove" : "minecraft:plains",
    }),
    "/biomes/grid": (_url, init) => {
      const request = JSON.parse(init?.body as string) as {
        dim: string;
        y: number;
        minX: number;
        minZ: number;
        step: number;
        w: number;
        h: number;
      };
      const data: number[] = [];
      for (let row = 0; row < request.h; row++) {
        for (let col = 0; col < request.w; col++) {
          data.push(request.minX + col * request.step >= 1000 ? 1 : 0);
        }
      }
      return { ...request, palette: ["minecraft:plains", "terralith:alpine_grove"], data };
    },
  };
}

describe("gate m2", () => {
  it("fails while the terralith fixture is unpopulated, with the how-to in the detail", async () => {
    const options = gateOptions();
    await writeFile(options.terralithFixturePath, JSON.stringify({ status: "unpopulated", howToPopulate: "use --record" }));
    const client = new OracleClient("http://o", fakeOracle(m2Routes()));
    const report = await runGate("m2", client, options, silent);
    expect(gatePassed(report)).toBe(false);
    expect(formatGateReport(report)).toContain("[PASS] /registry/biomes contains >=1 terralith: id");
    expect(formatGateReport(report)).toContain("use --record");
  });

  it("records the fixture from a grid scan and then passes", async () => {
    const options = gateOptions({ record: true });
    await writeFile(options.terralithFixturePath, JSON.stringify({ status: "unpopulated", howToPopulate: "x" }));
    const client = new OracleClient("http://o", fakeOracle(m2Routes()));
    const report = await runGate("m2", client, options, silent);
    expect(gatePassed(report)).toBe(true);

    const fixture = parseTerralithFixture(JSON.parse(await readFile(options.terralithFixturePath, "utf8")));
    expect(fixture.status).toBe("populated");
    if (fixture.status === "populated") {
      expect(fixture.expectedBiome).toBe("terralith:alpine_grove");
      expect(fixture.x).toBeGreaterThanOrEqual(1000);
      expect(fixture.recordedBy).toBe("tester@ci");
      expect(fixture.oracle.packFingerprint).toBe(META.packFingerprint);
    }
  });

  it("fails when no terralith biome is registered", async () => {
    const options = gateOptions();
    await writeFile(options.terralithFixturePath, JSON.stringify({ status: "unpopulated", howToPopulate: "x" }));
    const routes = m2Routes();
    routes["/registry/biomes"] = () => ({ biomes: [{ id: "minecraft:plains", namespace: "minecraft", color: "#8db360" }] });
    const client = new OracleClient("http://o", fakeOracle(routes));
    const report = await runGate("m2", client, options, silent);
    expect(gatePassed(report)).toBe(false);
    expect(formatGateReport(report)).toContain("[FAIL] /registry/biomes contains >=1 terralith: id");
  });

  it("recordTerralithFixture explains itself when the scan finds nothing", async () => {
    const routes = m2Routes();
    routes["/biomes/grid"] = (_url, init) => {
      const request = JSON.parse(init?.body as string) as { w: number; h: number };
      return {
        ...(JSON.parse(init?.body as string) as Record<string, unknown>),
        palette: ["minecraft:plains"],
        data: new Array<number>(request.w * request.h).fill(0),
      };
    };
    const client = new OracleClient("http://o", fakeOracle(routes));
    await expect(
      recordTerralithFixture(client, path.join(tmpDir, "t.json"), "tester@ci", silent),
    ).rejects.toThrow(/No terralith: biome found/);
  });
});

function m3Routes(): Record<string, RouteHandler> {
  return {
    "/meta": () => META,
    "/registry/structures": () => ({
      structures: [
        { id: "cobbleverse:gym_fire", namespace: "cobbleverse", sets: ["cobbleverse:gyms"], dimensions: ["minecraft:overworld"] },
      ],
    }),
    "/structures/placed": (url) => {
      const centerX = (intParam(url, "minX") + intParam(url, "maxX")) / 2;
      const centerZ = (intParam(url, "minZ") + intParam(url, "maxZ")) / 2;
      return { dim: url.searchParams.get("dim"), features: [feature("cobbleverse:gym_fire", centerX + 10, centerZ + 10)] };
    },
    "/locate": (url) => ({
      structure: "cobbleverse:gym_fire",
      x: intParam(url, "x") + 10,
      z: intParam(url, "z") + 10,
      distance: 14.1,
    }),
  };
}

describe("gate m3", () => {
  it("passes when cobbleverse structures are registered and locate agrees 100%", async () => {
    const client = new OracleClient("http://o", fakeOracle(m3Routes()));
    const report = await runGate("m3", client, gateOptions(), silent);
    expect(gatePassed(report)).toBe(true);
    const text = formatGateReport(report);
    expect(text).toContain("[PASS] /registry/structures contains cobbleverse: ids");
    expect(text).toContain("[PASS] validate locate agrees 100%");
  });

  it("fails when locate disagrees", async () => {
    const routes = m3Routes();
    routes["/locate"] = (url) => ({
      structure: "cobbleverse:gym_fire",
      x: intParam(url, "x") + 16,
      z: intParam(url, "z") + 16,
      distance: 22.6,
    });
    const client = new OracleClient("http://o", fakeOracle(routes));
    const report = await runGate("m3", client, gateOptions(), silent);
    expect(gatePassed(report)).toBe(false);
    expect(formatGateReport(report)).toContain("[FAIL] validate locate agrees 100%");
  });

  it("fails when no cobbleverse namespace is registered", async () => {
    const routes = m3Routes();
    routes["/registry/structures"] = () => ({
      structures: [
        { id: "minecraft:village_plains", namespace: "minecraft", sets: ["minecraft:villages"], dimensions: ["minecraft:overworld"] },
      ],
    });
    const client = new OracleClient("http://o", fakeOracle(routes));
    const report = await runGate("m3", client, gateOptions(), silent);
    expect(gatePassed(report)).toBe(false);
    expect(formatGateReport(report)).toContain("namespaces present: minecraft");
  });
});
