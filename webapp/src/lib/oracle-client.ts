/** Typed fetch client for the oracle HTTP API (docs/oracle-api.md). */

import type {
  BiomeResponse,
  BiomesGridRequest,
  BiomesGridResponse,
  LocateResponse,
  OracleErrorBody,
  OracleMeta,
  RegistryBiomesResponse,
  RegistryStructuresResponse,
  SeedVerifyRequest,
  SeedVerifyResponse,
  StructuresPlacedResponse,
  VerificationLevel,
} from "./types";

export const DEFAULT_ORACLE_BASE = "http://127.0.0.1:8765";

/**
 * Resolve the oracle base URL: `?oracle=<url>` query override, else default.
 * Trailing slashes are stripped.
 */
export function resolveOracleBase(
  search: string,
  fallback: string = DEFAULT_ORACLE_BASE,
): string {
  const value = new URLSearchParams(search).get("oracle");
  const base = value && value.trim() !== "" ? value.trim() : fallback;
  return base.replace(/\/+$/, "");
}

export class OracleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OracleError";
  }
}

function isErrorBody(value: unknown): value is OracleErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

export interface StructuresPlacedParams {
  dim: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  types?: readonly string[];
  level?: Exclude<VerificationLevel, "grid">;
}

export class OracleClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw new OracleError(
        "unreachable",
        `oracle not reachable at ${this.baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (isErrorBody(body)) {
        throw new OracleError(body.error.code, body.error.message);
      }
      throw new OracleError(
        `http_${response.status}`,
        `oracle returned HTTP ${response.status} for ${path}`,
      );
    }
    return (await response.json()) as T;
  }

  meta(): Promise<OracleMeta> {
    return this.request<OracleMeta>("/meta");
  }

  biome(dim: string, x: number, y: number, z: number): Promise<BiomeResponse> {
    const q = new URLSearchParams({
      dim,
      x: String(x),
      y: String(y),
      z: String(z),
    });
    return this.request<BiomeResponse>(`/biome?${q.toString()}`);
  }

  biomesGrid(req: BiomesGridRequest): Promise<BiomesGridResponse> {
    return this.request<BiomesGridResponse>("/biomes/grid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  }

  structuresPlaced(
    params: StructuresPlacedParams,
  ): Promise<StructuresPlacedResponse> {
    const q = new URLSearchParams({
      dim: params.dim,
      minX: String(params.minX),
      minZ: String(params.minZ),
      maxX: String(params.maxX),
      maxZ: String(params.maxZ),
    });
    if (params.types && params.types.length > 0) {
      q.set("types", params.types.join(","));
    }
    if (params.level) q.set("level", params.level);
    return this.request<StructuresPlacedResponse>(
      `/structures/placed?${q.toString()}`,
    );
  }

  locate(
    dim: string,
    x: number,
    z: number,
    structure: string,
  ): Promise<LocateResponse> {
    const q = new URLSearchParams({
      dim,
      x: String(x),
      z: String(z),
      structure,
    });
    return this.request<LocateResponse>(`/locate?${q.toString()}`);
  }

  registryStructures(): Promise<RegistryStructuresResponse> {
    return this.request<RegistryStructuresResponse>("/registry/structures");
  }

  registryBiomes(): Promise<RegistryBiomesResponse> {
    return this.request<RegistryBiomesResponse>("/registry/biomes");
  }

  seedVerify(req: SeedVerifyRequest): Promise<SeedVerifyResponse> {
    return this.request<SeedVerifyResponse>("/seed/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  }
}
