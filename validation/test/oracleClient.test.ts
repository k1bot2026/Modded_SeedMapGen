import { describe, expect, it } from "vitest";
import { ContractViolationError, OracleHttpError, OracleUnreachableError } from "../src/errors.js";
import { buildQuery, OracleClient } from "../src/oracle-client.js";
import { errorResponse, fakeOracle, intParam, jsonResponse, META, pngBytes, pngResponse } from "./helpers.js";

describe("buildQuery", () => {
  it("keeps ':' and ',' raw (contract-friendly) but percent-encodes '#'", () => {
    expect(buildQuery({ dim: "minecraft:overworld", types: "a:x,b:y", structure: "#minecraft:village" })).toBe(
      "dim=minecraft:overworld&types=a:x,b:y&structure=%23minecraft:village",
    );
  });
});

describe("OracleClient", () => {
  it("parses /meta and strips trailing slashes from the base URL", async () => {
    const client = new OracleClient("http://127.0.0.1:8765/", fakeOracle({ "/meta": () => META }));
    expect(client.baseUrl).toBe("http://127.0.0.1:8765");
    const meta = await client.meta();
    expect(meta.seed).toBe("1234");
    expect(meta.mods.map((mod) => mod.id)).toContain("seedmap-oracle");
  });

  it("rejects a numeric /meta seed as a contract violation", async () => {
    const client = new OracleClient("http://o", fakeOracle({ "/meta": () => ({ ...META, seed: 1234 }) }));
    await expect(client.meta()).rejects.toThrow(ContractViolationError);
  });

  it("builds /biome and /locate URLs with raw ':' and encoded '#'", async () => {
    const seen: string[] = [];
    const fetchImpl = (url: string): Promise<Response> => {
      seen.push(url);
      return Promise.resolve(
        url.includes("/biome?")
          ? jsonResponse({ dim: "minecraft:overworld", x: 1, y: 64, z: 2, biome: "minecraft:plains" })
          : jsonResponse({ structure: "minecraft:village_plains", x: 100, z: -200, distance: 223.6 }),
      );
    };
    const client = new OracleClient("http://o", fetchImpl);
    await client.biome("minecraft:overworld", 1, 64, 2);
    await client.locate("minecraft:overworld", 0, 0, "#minecraft:village");
    expect(seen[0]).toBe("http://o/biome?dim=minecraft:overworld&x=1&y=64&z=2");
    expect(seen[1]).toBe("http://o/locate?dim=minecraft:overworld&x=0&z=0&structure=%23minecraft:village");
  });

  it("maps /locate 404 not_found to { found: false } but rethrows other errors", async () => {
    const notFoundClient = new OracleClient(
      "http://o",
      fakeOracle({ "/locate": () => errorResponse("not_found", "nothing in range", 404) }),
    );
    await expect(notFoundClient.locate("minecraft:overworld", 0, 0, "minecraft:stronghold")).resolves.toEqual({
      found: false,
    });

    const badParamClient = new OracleClient(
      "http://o",
      fakeOracle({ "/locate": () => errorResponse("unknown_structure", "no such structure", 400) }),
    );
    await expect(badParamClient.locate("minecraft:overworld", 0, 0, "typo:zzz")).rejects.toMatchObject({
      name: "OracleHttpError",
      code: "unknown_structure",
      status: 400,
    });
  });

  it("parses the contract error envelope and falls back to http_<status>", async () => {
    const enveloped = new OracleClient("http://o", fakeOracle({ "/meta": () => errorResponse("internal", "boom", 500) }));
    await expect(enveloped.meta()).rejects.toThrow(OracleHttpError);
    const plain = new OracleClient("http://o", () => Promise.resolve(new Response("nope", { status: 502 })));
    await expect(plain.meta()).rejects.toMatchObject({ code: "http_502" });
  });

  it("wraps network failures in OracleUnreachableError with a hint", async () => {
    const client = new OracleClient("http://o", () => Promise.reject(new Error("ECONNREFUSED")));
    await expect(client.meta()).rejects.toThrow(OracleUnreachableError);
    await expect(client.meta()).rejects.toThrow(/Is it running/);
  });

  it("POSTs /biomes/grid with the request body and returns raw bytes + parsed grid", async () => {
    let captured: unknown;
    const client = new OracleClient(
      "http://o",
      fakeOracle({
        "/biomes/grid": (_url, init) => {
          captured = JSON.parse(init?.body as string);
          return { dim: "minecraft:overworld", y: 64, minX: 0, minZ: 0, step: 4, w: 2, h: 1, palette: ["minecraft:plains"], data: [0, 0] };
        },
      }),
    );
    const request = { dim: "minecraft:overworld", y: 64, minX: 0, minZ: 0, step: 4, w: 2, h: 1 };
    const { bytes, grid } = await client.biomesGridRaw(request);
    expect(captured).toEqual(request);
    expect(grid.palette).toEqual(["minecraft:plains"]);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("passes types and level through to /structures/placed", async () => {
    let seen: URL | null = null;
    const client = new OracleClient(
      "http://o",
      fakeOracle({
        "/structures/placed": (url) => {
          seen = url;
          return { dim: "minecraft:overworld", features: [] };
        },
      }),
    );
    await client.structuresPlaced(
      "minecraft:overworld",
      { minX: -512, minZ: -512, maxX: 512, maxZ: 512 },
      { types: ["cobbleverse:gym_fire", "minecraft:village_plains"], level: "start_ok" },
    );
    expect(seen).not.toBeNull();
    expect(seen!.search).toContain("types=cobbleverse:gym_fire,minecraft:village_plains");
    expect(seen!.search).toContain("level=start_ok");
    expect(seen!.search).toContain("minX=-512");
  });

  it("rejects a placed feature with an unknown level", async () => {
    const client = new OracleClient(
      "http://o",
      fakeOracle({
        "/structures/placed": () => ({
          dim: "minecraft:overworld",
          features: [{ id: "a:b", structureSet: "a:s", x: 0, z: 0, chunkX: 0, chunkZ: 0, level: "vibes_ok" }],
        }),
      }),
    );
    await expect(
      client.structuresPlaced("minecraft:overworld", { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }),
    ).rejects.toThrow(ContractViolationError);
  });

  it("fetches tiles with timing and X-Cache header when present", async () => {
    const client = new OracleClient(
      "http://o",
      fakeOracle({ "/tiles/*": (url) => pngResponse(pngBytes(url.pathname), { "X-Cache": "HIT" }) }),
    );
    const tile = await client.tile("minecraft:overworld", 64, 0, -1, 2);
    expect(tile.path).toBe("/tiles/minecraft:overworld/64/0/-1/2.png");
    expect(tile.xCache).toBe("HIT");
    expect(tile.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(tile.bytes.length).toBeGreaterThan(8);
  });

  it("round-trips /seed/verify with string seeds", async () => {
    let captured: unknown;
    const client = new OracleClient(
      "http://o",
      fakeOracle({
        "/seed/verify": (_url, init) => {
          captured = JSON.parse(init?.body as string);
          return { results: [{ seed: "-9223372036854775808", matches: 1, total: 1, verdict: "match", details: [] }] };
        },
      }),
    );
    const response = await client.seedVerify({
      candidates: ["-9223372036854775808"],
      observations: [{ type: "biome", dim: "minecraft:overworld", x: 0, y: 64, z: 0, expected: "minecraft:plains" }],
    });
    expect((captured as { candidates: string[] }).candidates[0]).toBe("-9223372036854775808");
    expect(response.results[0]!.seed).toBe("-9223372036854775808");
  });

  it("fetches /structures/candidates for a set", async () => {
    const client = new OracleClient(
      "http://o",
      fakeOracle({
        "/structures/candidates": (url) => ({
          dim: url.searchParams.get("dim"),
          structureSet: url.searchParams.get("structureSet"),
          candidates: [{ chunkX: intParam(url, "minX") >> 4, chunkZ: 0, blockX: 8, blockZ: 8 }],
        }),
      }),
    );
    const response = await client.structuresCandidates("minecraft:overworld", "minecraft:villages", {
      minX: 0,
      minZ: 0,
      maxX: 1024,
      maxZ: 1024,
    });
    expect(response.structureSet).toBe("minecraft:villages");
    expect(response.candidates).toHaveLength(1);
  });
});
