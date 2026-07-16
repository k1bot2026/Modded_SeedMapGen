import { describe, expect, it } from "vitest";
import { runSelfConsistency } from "../src/commands/selfConsistency.js";
import { OracleClient } from "../src/oracle-client.js";
import { fakeOracle, feature, intParam, META, pngBytes, pngResponse, type RouteHandler } from "./helpers.js";

const REGISTRY_STRUCTURES = {
  structures: [
    { id: "minecraft:village_plains", namespace: "minecraft", sets: ["minecraft:villages"], dimensions: ["minecraft:overworld"] },
  ],
};
const REGISTRY_BIOMES = {
  biomes: [{ id: "minecraft:plains", namespace: "minecraft", color: "#8db360" }],
};

/** Deterministic oracle: every answer is a pure function of the request. */
function consistentRoutes(overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> {
  return {
    "/meta": () => META,
    "/registry/structures": () => REGISTRY_STRUCTURES,
    "/registry/biomes": () => REGISTRY_BIOMES,
    "/biomes/grid": (_url, init) => {
      const request = JSON.parse(init?.body as string) as { w: number; h: number };
      return {
        ...(JSON.parse(init?.body as string) as Record<string, unknown>),
        palette: ["minecraft:plains"],
        data: new Array<number>(request.w * request.h).fill(0),
      };
    },
    "/tiles/*": (url) => pngResponse(pngBytes(url.pathname)),
    "/structures/placed": (url) => ({
      dim: url.searchParams.get("dim"),
      features: [feature("minecraft:village_plains", intParam(url, "minX") + 32, intParam(url, "minZ") + 32)],
    }),
    ...overrides,
  };
}

const silent = (): void => {};
const SMALL = { grids: 2, tiles: 2, bboxes: 1, seedRng: 42 };

function clients(routesB: Record<string, RouteHandler>): [OracleClient, OracleClient] {
  return [
    new OracleClient("http://a", fakeOracle(consistentRoutes())),
    new OracleClient("http://b", fakeOracle(routesB)),
  ];
}

describe("runSelfConsistency", () => {
  it("passes for two byte-identical oracles and counts every check", async () => {
    const [a, b] = clients(consistentRoutes());
    const result = await runSelfConsistency(a, b, SMALL, silent);
    expect(result.ok).toBe(true);
    expect(result.divergence).toBeNull();
    // meta + 2 registries + grids + tiles + bboxes
    expect(result.checksRun).toBe(3 + SMALL.grids + SMALL.tiles + SMALL.bboxes);
  });

  it("reports a /meta seed divergence first and precisely", async () => {
    const [a, b] = clients(consistentRoutes({ "/meta": () => ({ ...META, seed: "5678" }) }));
    const result = await runSelfConsistency(a, b, SMALL, silent);
    expect(result.ok).toBe(false);
    expect(result.divergence!.where).toBe("/meta");
    expect(result.divergence!.detail).toContain("$.seed");
    expect(result.checksRun).toBe(1);
  });

  it("reports the first differing byte of a diverging /biomes/grid response", async () => {
    const [a, b] = clients(
      consistentRoutes({
        "/biomes/grid": (_url, init) => {
          const request = JSON.parse(init?.body as string) as { w: number; h: number };
          return {
            ...(JSON.parse(init?.body as string) as Record<string, unknown>),
            palette: ["minecraft:desert"],
            data: new Array<number>(request.w * request.h).fill(0),
          };
        },
      }),
    );
    const result = await runSelfConsistency(a, b, SMALL, silent);
    expect(result.ok).toBe(false);
    expect(result.divergence!.where).toContain("/biomes/grid");
    expect(result.divergence!.detail).toMatch(/first differing byte at index \d+/);
    expect(result.divergence!.detail).toContain("sha256");
  });

  it("reports diverging tile hashes with the tile path", async () => {
    const [a, b] = clients(consistentRoutes({ "/tiles/*": (url) => pngResponse(pngBytes(url.pathname + "-b")) }));
    const result = await runSelfConsistency(a, b, SMALL, silent);
    expect(result.ok).toBe(false);
    expect(result.divergence!.where).toMatch(/^tile \/tiles\//);
    expect(result.divergence!.detail).toContain("sha256 A=");
  });

  it("reports diverging placed-structure sets on a bbox", async () => {
    const [a, b] = clients(
      consistentRoutes({
        "/structures/placed": (url) => ({
          dim: url.searchParams.get("dim"),
          features: [feature("minecraft:village_plains", intParam(url, "minX") + 48, intParam(url, "minZ") + 32)],
        }),
      }),
    );
    const result = await runSelfConsistency(a, b, SMALL, silent);
    expect(result.ok).toBe(false);
    expect(result.divergence!.where).toContain("/structures/placed");
    expect(result.divergence!.detail).toContain("$[0].");
  });

  it("reports registry divergences", async () => {
    const [a, b] = clients(
      consistentRoutes({
        "/registry/biomes": () => ({ biomes: [{ id: "minecraft:plains", namespace: "minecraft", color: "#000000" }] }),
      }),
    );
    const result = await runSelfConsistency(a, b, SMALL, silent);
    expect(result.ok).toBe(false);
    expect(result.divergence!.where).toBe("/registry/biomes");
    expect(result.divergence!.detail).toContain("color");
  });
});
