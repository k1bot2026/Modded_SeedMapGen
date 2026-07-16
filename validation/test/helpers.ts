/** Shared fakes: an in-memory oracle behind FetchLike. No test touches the network. */
import type { FetchLike, OracleMeta, PlacedFeature } from "../src/oracle-client.js";

export const META: OracleMeta = {
  mcVersion: "1.21.1",
  loaderVersion: "0.16.14",
  oracleModVersion: "0.1.0",
  seed: "1234",
  packName: "vanilla",
  packVersion: "1.21.1",
  packFingerprint: "sha256:testfingerprint",
  overlayDiff: [],
  dimensions: ["minecraft:overworld", "minecraft:the_end", "minecraft:the_nether"],
  mods: [
    { id: "fabric-api", version: "0.116.14+1.21.1", name: "Fabric API" },
    { id: "seedmap-oracle", version: "0.1.0", name: "Seedmap Oracle" },
  ],
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngBytes(tag = ""): Uint8Array {
  return new Uint8Array([...PNG_MAGIC, ...new TextEncoder().encode(tag)]);
}

export function pngResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png", ...headers } });
}

export type RouteHandler = (url: URL, init?: RequestInit) => unknown;

/**
 * Route table keyed by pathname; a trailing '*' matches by prefix. Handlers may
 * return a Response or any JSON-serializable value. Unmatched paths get the
 * contract's 404 not_found envelope.
 */
export function fakeOracle(routes: Record<string, RouteHandler>): FetchLike {
  return (input, init) => {
    const url = new URL(input);
    for (const [pattern, handler] of Object.entries(routes)) {
      const matches = pattern.endsWith("*")
        ? url.pathname.startsWith(pattern.slice(0, -1))
        : url.pathname === pattern;
      if (matches) {
        const result = handler(url, init);
        return Promise.resolve(result instanceof Response ? result : jsonResponse(result));
      }
    }
    return Promise.resolve(errorResponse("not_found", `no route for ${url.pathname}`, 404));
  };
}

export function intParam(url: URL, name: string): number {
  const raw = url.searchParams.get(name);
  if (raw === null) throw new Error(`missing query param ${name} in ${url.href}`);
  return Number.parseInt(raw, 10);
}

export function feature(id: string, x: number, z: number, level: PlacedFeature["level"] = "biome_ok"): PlacedFeature {
  return { id, structureSet: `${id}_set`, x, z, chunkX: x >> 4, chunkZ: z >> 4, level };
}
