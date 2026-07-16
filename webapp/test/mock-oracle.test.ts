/**
 * Contract-shape tests for the dev mock oracle. Runs entirely on localhost
 * (an ephemeral port) — no external network.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockOracle } from "../mock/mock-oracle.mjs";
import type {
  BiomeResponse,
  BiomesGridResponse,
  LocateResponse,
  OracleErrorBody,
  OracleMeta,
  RegistryBiomesResponse,
  RegistryStructuresResponse,
  SeedVerifyResponse,
  StructuresPlacedResponse,
} from "../src/lib/types";

const server = createMockOracle({ seed: "1234" });
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("GET /meta", () => {
  it("returns the Mockpack meta with a string seed and 3 dimensions", async () => {
    const res = await fetch(`${base}/meta`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const meta = (await res.json()) as OracleMeta;
    expect(meta.packName).toBe("Mockpack");
    expect(meta.packVersion).toBe("1.0.0");
    expect(meta.mcVersion).toBe("1.21.1");
    expect(meta.seed).toBe("1234");
    expect(typeof meta.seed).toBe("string");
    expect(meta.dimensions).toHaveLength(3);
    expect(meta.dimensions).toContain("minecraft:overworld");
  });
});

describe("GET /biome and POST /biomes/grid", () => {
  it("is deterministic", async () => {
    const url = `${base}/biome?dim=minecraft:overworld&x=100&y=64&z=-200`;
    const a = (await (await fetch(url)).json()) as BiomeResponse;
    const b = (await (await fetch(url)).json()) as BiomeResponse;
    expect(a).toEqual(b);
    expect(a.biome).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it("grid agrees with single-point /biome and is palette-compressed", async () => {
    const req = { dim: "minecraft:overworld", y: 64, minX: -64, minZ: -64, step: 16, w: 8, h: 8 };
    const res = await fetch(`${base}/biomes/grid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    expect(res.status).toBe(200);
    const grid = (await res.json()) as BiomesGridResponse;
    expect(grid.data).toHaveLength(64);
    expect(Math.max(...grid.data)).toBeLessThan(grid.palette.length);
    // sample (row=2, col=5) = block (minX + 5*16, minZ + 2*16) = (16, -32)
    const single = (await (
      await fetch(`${base}/biome?dim=minecraft:overworld&x=16&y=64&z=-32`)
    ).json()) as BiomeResponse;
    expect(grid.palette[grid.data[2 * 8 + 5] ?? -1]).toBe(single.biome);
  });

  it("rejects oversized grids with too_large", async () => {
    const res = await fetch(`${base}/biomes/grid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dim: "minecraft:overworld", y: 64, minX: 0, minZ: 0, step: 4, w: 513, h: 512 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OracleErrorBody;
    expect(body.error.code).toBe("too_large");
  });

  it("rejects unknown dimensions", async () => {
    const res = await fetch(`${base}/biome?dim=foo:bar&x=0&y=64&z=0`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as OracleErrorBody;
    expect(body.error.code).toBe("unknown_dimension");
  });
});

describe("GET /tiles", () => {
  it("returns a real 256x256 PNG, negative tile indices included", async () => {
    const res = await fetch(`${base}/tiles/minecraft:overworld/64/0/-1/2.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PNG signature
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR width/height at offsets 16 and 20 (big-endian)
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16)).toBe(256);
    expect(view.getUint32(20)).toBe(256);
  });

  it("is byte-identical across repeated requests (determinism)", async () => {
    const [a, b] = await Promise.all([
      fetch(`${base}/tiles/minecraft:the_nether/64/3/5/-7.png`).then((r) => r.arrayBuffer()),
      fetch(`${base}/tiles/minecraft:the_nether/64/3/5/-7.png`).then((r) => r.arrayBuffer()),
    ]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("rejects out-of-range zooms", async () => {
    const res = await fetch(`${base}/tiles/minecraft:overworld/64/7/0/0.png`);
    expect(res.status).toBe(400);
  });
});

describe("structures", () => {
  it("placed features carry contract fields and respect bbox + types", async () => {
    const res = await fetch(
      `${base}/structures/placed?dim=minecraft:overworld&minX=-4096&minZ=-4096&maxX=4096&maxZ=4096&types=minecraft:village_plains`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as StructuresPlacedResponse;
    expect(body.features.length).toBeGreaterThan(0);
    for (const f of body.features) {
      expect(f.id).toBe("minecraft:village_plains");
      expect(f.structureSet).toBe("minecraft:villages");
      expect(f.level).toBe("biome_ok");
      expect(f.x).toBeGreaterThanOrEqual(-4096);
      expect(f.x).toBeLessThanOrEqual(4096);
      expect(f.chunkX).toBe(Math.floor(f.x / 16));
      expect(f.chunkZ).toBe(Math.floor(f.z / 16));
    }
  });

  it("start_ok is a subset of biome_ok", async () => {
    const bbox = "minX=-4096&minZ=-4096&maxX=4096&maxZ=4096";
    const [biomeOk, startOk] = await Promise.all([
      fetch(`${base}/structures/placed?dim=minecraft:overworld&${bbox}&level=biome_ok`).then(
        (r) => r.json() as Promise<StructuresPlacedResponse>,
      ),
      fetch(`${base}/structures/placed?dim=minecraft:overworld&${bbox}&level=start_ok`).then(
        (r) => r.json() as Promise<StructuresPlacedResponse>,
      ),
    ]);
    const biomeOkKeys = new Set(biomeOk.features.map((f) => `${f.id}@${f.chunkX},${f.chunkZ}`));
    expect(startOk.features.length).toBeGreaterThan(0);
    expect(startOk.features.length).toBeLessThan(biomeOk.features.length);
    for (const f of startOk.features) {
      expect(f.level).toBe("start_ok");
      expect(biomeOkKeys.has(`${f.id}@${f.chunkX},${f.chunkZ}`)).toBe(true);
    }
  });

  it("locate returns the nearest placed candidate of the type", async () => {
    const res = await fetch(
      `${base}/locate?dim=minecraft:overworld&x=0&z=0&structure=minecraft:village_plains`,
    );
    expect(res.status).toBe(200);
    const loc = (await res.json()) as LocateResponse;
    expect(loc.structure).toBe("minecraft:village_plains");
    expect(loc.distance).toBeCloseTo(Math.hypot(loc.x, loc.z), 0);
    // Cross-check: no placed village in a large bbox is closer.
    const placed = (await (
      await fetch(
        `${base}/structures/placed?dim=minecraft:overworld&minX=-4096&minZ=-4096&maxX=4096&maxZ=4096&types=minecraft:village_plains`,
      )
    ).json()) as StructuresPlacedResponse;
    for (const f of placed.features) {
      expect(Math.hypot(f.x, f.z)).toBeGreaterThanOrEqual(loc.distance - 0.11);
    }
  });

  it("unknown structure -> unknown_structure error", async () => {
    const res = await fetch(`${base}/locate?dim=minecraft:overworld&x=0&z=0&structure=foo:bar`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as OracleErrorBody;
    expect(body.error.code).toBe("unknown_structure");
  });
});

describe("registries", () => {
  it("include minecraft:, terralith: and cobbleverse: namespaces", async () => {
    const structures = (await (
      await fetch(`${base}/registry/structures`)
    ).json()) as RegistryStructuresResponse;
    const biomes = (await (await fetch(`${base}/registry/biomes`)).json()) as RegistryBiomesResponse;
    const structureNs = new Set(structures.structures.map((s) => s.namespace));
    const biomeNs = new Set(biomes.biomes.map((b) => b.namespace));
    for (const ns of ["minecraft", "terralith", "cobbleverse"]) {
      expect(structureNs.has(ns)).toBe(true);
      expect(biomeNs.has(ns)).toBe(true);
    }
    for (const b of biomes.biomes) {
      expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const s of structures.structures) {
      expect(s.sets.length).toBeGreaterThan(0);
      expect(s.dimensions.length).toBeGreaterThan(0);
    }
  });
});

describe("POST /seed/verify", () => {
  it("matches the served seed and mismatches others", async () => {
    // Build observations from truth the mock itself serves.
    const b = (await (
      await fetch(`${base}/biome?dim=minecraft:overworld&x=500&y=64&z=-500`)
    ).json()) as BiomeResponse;
    const loc = (await (
      await fetch(`${base}/locate?dim=minecraft:overworld&x=0&z=0&structure=minecraft:village_plains`)
    ).json()) as LocateResponse;
    const res = await fetch(`${base}/seed/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates: ["1234", "9999"],
        observations: [
          { type: "biome", dim: "minecraft:overworld", x: 500, y: 64, z: -500, expected: b.biome },
          { type: "structure", dim: "minecraft:overworld", x: loc.x, z: loc.z, expected: "minecraft:village_plains" },
          { type: "bedrock", dim: "minecraft:overworld", x: 0, y: -60, z: 0, expected: "bedrock" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SeedVerifyResponse;
    expect(body.results).toHaveLength(2);
    const [right, wrong] = body.results;
    expect(right?.seed).toBe("1234");
    expect(right?.verdict).toBe("match");
    expect(right?.matches).toBe(2);
    expect(right?.total).toBe(2); // bedrock excluded from totals
    expect(right?.details[2]).toMatchObject({ match: null, unsupported: true });
    expect(wrong?.verdict).toBe("mismatch");
  });

  it("enforces candidate/observation caps", async () => {
    const res = await fetch(`${base}/seed/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates: Array.from({ length: 17 }, (_, i) => String(i)),
        observations: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OracleErrorBody;
    expect(body.error.code).toBe("too_large");
  });
});

describe("CORS preflight", () => {
  it("answers OPTIONS with the contract headers", async () => {
    const res = await fetch(`${base}/biomes/grid`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });
});
