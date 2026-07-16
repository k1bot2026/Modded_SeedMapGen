import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORACLE_BASE,
  OracleClient,
  OracleError,
  resolveOracleBase,
} from "../src/lib/oracle-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveOracleBase", () => {
  it("defaults to 127.0.0.1:8765", () => {
    expect(resolveOracleBase("")).toBe(DEFAULT_ORACLE_BASE);
    expect(resolveOracleBase("?foo=1")).toBe("http://127.0.0.1:8765");
  });

  it("honors the ?oracle= override and strips trailing slashes", () => {
    expect(resolveOracleBase("?oracle=http://192.168.1.5:9000/")).toBe(
      "http://192.168.1.5:9000",
    );
    expect(resolveOracleBase("?oracle=")).toBe(DEFAULT_ORACLE_BASE);
  });
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  // OracleClient always calls fetch with a string URL.
  const spy = vi.fn((input: string, init?: RequestInit) =>
    Promise.resolve(handler(input, init)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("OracleClient", () => {
  it("builds query URLs per the contract", async () => {
    const spy = stubFetch(() => Response.json({ dim: "d", x: 1, y: 64, z: -2, biome: "b" }));
    const client = new OracleClient("http://127.0.0.1:8765/");
    await client.biome("minecraft:overworld", 1, 64, -2);
    const url = spy.mock.calls[0]?.[0] ?? "";
    expect(url.startsWith("http://127.0.0.1:8765/biome?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("dim")).toBe("minecraft:overworld");
    expect(params.get("x")).toBe("1");
    expect(params.get("y")).toBe("64");
    expect(params.get("z")).toBe("-2");
  });

  it("joins types with commas and passes level for /structures/placed", async () => {
    const spy = stubFetch(() => Response.json({ dim: "d", features: [] }));
    const client = new OracleClient("http://127.0.0.1:8765");
    await client.structuresPlaced({
      dim: "minecraft:overworld",
      minX: -100,
      minZ: -100,
      maxX: 100,
      maxZ: 100,
      types: ["a:b", "c:d"],
      level: "start_ok",
    });
    const params = new URL(spy.mock.calls[0]?.[0] ?? "").searchParams;
    expect(params.get("types")).toBe("a:b,c:d");
    expect(params.get("level")).toBe("start_ok");
    expect(params.get("minX")).toBe("-100");
  });

  it("keeps seeds as strings in /seed/verify", async () => {
    const spy = stubFetch(() => Response.json({ results: [] }));
    const client = new OracleClient("http://127.0.0.1:8765");
    const bigSeed = "-1234567890123456789";
    await client.seedVerify({ candidates: [bigSeed], observations: [] });
    const body = spy.mock.calls[0]?.[1]?.body as string;
    expect(JSON.parse(body)).toEqual({ candidates: [bigSeed], observations: [] });
    expect(body).toContain(`"${bigSeed}"`);
  });

  it("throws OracleError with the contract error code on non-2xx", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: "unknown_dimension", message: "nope" } }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new OracleClient("http://127.0.0.1:8765");
    await expect(client.biome("bad:dim", 0, 64, 0)).rejects.toMatchObject({
      name: "OracleError",
      code: "unknown_dimension",
    });
  });

  it("wraps network failures as 'unreachable'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const client = new OracleClient("http://127.0.0.1:1");
    const err = await client.meta().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OracleError);
    expect((err as OracleError).code).toBe("unreachable");
  });
});
