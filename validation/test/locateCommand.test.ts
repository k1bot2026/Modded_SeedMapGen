import { describe, expect, it } from "vitest";
import { formatLocateMismatch, runLocateValidation } from "../src/commands/locate.js";
import { OracleClient } from "../src/oracle-client.js";
import { fakeOracle, feature, intParam, META, type RouteHandler } from "./helpers.js";

const REGISTRY = {
  structures: [
    {
      id: "test:widget",
      namespace: "test",
      sets: ["test:widgets"],
      dimensions: ["minecraft:overworld"],
    },
  ],
};

/**
 * Deterministic fake worldgen: the placed layer answers with one widget at the
 * bbox center + offset; /locate answers relative to the queried origin. When
 * both use the same offset they must agree (the placed bbox is centered on the
 * origin by construction of the search).
 */
function worldgenRoutes(placedOffset: number, locateOffset: number): Record<string, RouteHandler> {
  return {
    "/meta": () => META,
    "/registry/structures": () => REGISTRY,
    "/structures/placed": (url) => {
      const centerX = (intParam(url, "minX") + intParam(url, "maxX")) / 2;
      const centerZ = (intParam(url, "minZ") + intParam(url, "maxZ")) / 2;
      return {
        dim: url.searchParams.get("dim"),
        features: [feature("test:widget", centerX + placedOffset, centerZ + placedOffset)],
      };
    },
    "/locate": (url) => {
      const x = intParam(url, "x") + locateOffset;
      const z = intParam(url, "z") + locateOffset;
      return { structure: "test:widget", x, z, distance: Math.hypot(locateOffset, locateOffset) };
    },
  };
}

const silent = (): void => {};

describe("runLocateValidation", () => {
  it("agrees 100% when placed-search and /locate answer the same position", async () => {
    const client = new OracleClient("http://o", fakeOracle(worldgenRoutes(10, 10)));
    const summary = await runLocateValidation(client, { perDim: 5, seedRng: 42 }, silent);
    expect(summary.comparisons).toBe(5);
    expect(summary.agreements).toBe(5);
    expect(summary.mismatches).toHaveLength(0);
    expect(summary.dimsChecked).toEqual(["minecraft:overworld"]);
    expect(summary.typesPerDim["minecraft:the_nether"]).toBe(0);
  });

  it("is deterministic for a fixed --seed-rng", async () => {
    const mismatchesOf = async (): Promise<string> => {
      const client = new OracleClient("http://o", fakeOracle(worldgenRoutes(10, 16)));
      const summary = await runLocateValidation(client, { perDim: 3, seedRng: 7 }, silent);
      return JSON.stringify(summary.mismatches.map((m) => m.origin));
    };
    expect(await mismatchesOf()).toBe(await mismatchesOf());
  });

  it("reports every mismatch with a full repro", async () => {
    const client = new OracleClient("http://o", fakeOracle(worldgenRoutes(10, 16)));
    const lines: string[] = [];
    const summary = await runLocateValidation(client, { perDim: 2, seedRng: 42 }, (line) => lines.push(line));
    expect(summary.mismatches).toHaveLength(2);
    const repro = formatLocateMismatch(client, summary.mismatches[0]!, "biome_ok");
    expect(repro).toContain("MISMATCH dim=minecraft:overworld");
    expect(repro).toContain("type=test:widget");
    expect(repro).toContain('curl "http://o/locate?dim=minecraft:overworld');
    expect(repro).toContain('curl "http://o/structures/placed?dim=minecraft:overworld');
    expect(lines.join("\n")).toContain("MISMATCH");
  });

  it("counts both-not-found as agreement (structure absent in range)", async () => {
    const routes = worldgenRoutes(10, 10);
    routes["/structures/placed"] = (url) => ({ dim: url.searchParams.get("dim"), features: [] });
    routes["/locate"] = () =>
      new Response(JSON.stringify({ error: { code: "not_found", message: "nothing in range" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    const client = new OracleClient("http://o", fakeOracle(routes));
    const summary = await runLocateValidation(client, { perDim: 4, seedRng: 42 }, silent);
    expect(summary.agreements).toBe(4);
    expect(summary.bothNotFound).toBe(4);
    expect(summary.mismatches).toHaveLength(0);
  });

  it("shares one placed query per origin radius across all types", async () => {
    let placedCalls = 0;
    const routes = worldgenRoutes(10, 10);
    const inner = routes["/structures/placed"]!;
    routes["/structures/placed"] = (url, init) => {
      placedCalls += 1;
      return inner(url, init);
    };
    routes["/registry/structures"] = () => ({
      structures: [
        { id: "test:widget", namespace: "test", sets: ["test:widgets"], dimensions: ["minecraft:overworld"] },
        { id: "test:gadget", namespace: "test", sets: ["test:gadgets"], dimensions: ["minecraft:overworld"] },
      ],
    });
    // The fake returns only widgets, so gadget searches walk the whole radius
    // schedule (3 queries) while widget searches reuse the first cached query.
    const client = new OracleClient("http://o", fakeOracle(routes));
    const summary = await runLocateValidation(client, { perDim: 2, seedRng: 42 }, silent);
    expect(summary.comparisons).toBe(4);
    expect(placedCalls).toBe(6); // 2 origins x 3 radii, shared across both types
  });
});
