/**
 * Typed client for the oracle HTTP API. Every shape here is hand-written from
 * docs/oracle-api.md — the contract, not the implementation, is the source of
 * truth. All HTTP goes through an injected FetchLike so tests never touch the
 * network, and 2xx bodies are structurally checked so a contract drift fails
 * loudly instead of corrupting a validation verdict.
 */
import { ContractViolationError, OracleHttpError, OracleUnreachableError } from "./errors.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Wire types (docs/oracle-api.md)
// ---------------------------------------------------------------------------

export interface OracleMod {
  id: string;
  version: string;
  name: string;
}

export interface OverlayDiffEntry {
  path: string;
  kind: "added" | "replaced" | "removed";
}

export interface OracleMeta {
  mcVersion: string;
  loaderVersion: string;
  oracleModVersion: string;
  /** 64-bit seed as a JSON string (contract rule); this client enforces it. */
  seed: string;
  packName: string;
  packVersion: string;
  packFingerprint: string;
  overlayDiff: OverlayDiffEntry[];
  dimensions: string[];
  mods: OracleMod[];
}

export interface BiomeAnswer {
  dim: string;
  x: number;
  y: number;
  z: number;
  biome: string;
}

export interface BiomesGridRequest {
  dim: string;
  y: number;
  minX: number;
  minZ: number;
  step: number;
  w: number;
  h: number;
}

export interface BiomesGridResponse extends BiomesGridRequest {
  palette: string[];
  /** Row-major: data[row*w + col] indexes palette; col runs along X, row along Z. */
  data: number[];
}

export interface StructureCandidate {
  chunkX: number;
  chunkZ: number;
  blockX: number;
  blockZ: number;
}

export interface CandidatesResponse {
  dim: string;
  structureSet: string;
  candidates: StructureCandidate[];
}

export type PlacedLevel = "grid" | "biome_ok" | "start_ok";

export interface PlacedFeature {
  id: string;
  structureSet: string;
  x: number;
  z: number;
  chunkX: number;
  chunkZ: number;
  level: PlacedLevel;
}

export interface PlacedResponse {
  dim: string;
  features: PlacedFeature[];
}

/** Block-coordinate bbox, inclusive-ish per the contract's query params. */
export interface BlockBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export type LocateResult =
  | { found: true; structure: string; x: number; z: number; distance: number }
  | { found: false };

export interface RegistryStructure {
  id: string;
  namespace: string;
  sets: string[];
  dimensions: string[];
}

export interface RegistryBiome {
  id: string;
  namespace: string;
  /** Exact tile-palette color, hex without alpha. */
  color: string;
}

export type SeedVerifyObservation =
  | { type: "biome"; dim: string; x: number; y: number; z: number; expected: string }
  | { type: "structure"; dim: string; x: number; z: number; expected: string }
  | { type: "bedrock"; dim: string; x: number; y: number; z: number; expected: unknown };

export interface SeedVerifyRequest {
  /** Seeds as strings, always. */
  candidates: string[];
  observations: SeedVerifyObservation[];
}

export interface SeedVerifyDetail {
  index: number;
  match: boolean | null;
  actual?: unknown;
  unsupported?: boolean;
}

export interface SeedVerifyResultEntry {
  seed: string;
  matches: number;
  total: number;
  verdict: "match" | "mismatch";
  details: SeedVerifyDetail[];
}

export interface SeedVerifyResponse {
  results: SeedVerifyResultEntry[];
}

export interface TileResult {
  /** Request path (no base URL), e.g. /tiles/minecraft:overworld/64/0/0/0.png */
  path: string;
  bytes: Uint8Array;
  elapsedMs: number;
  /** X-Cache header if the oracle sends one (it does not yet); null otherwise. */
  xCache: string | null;
  contentType: string | null;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * The contract allows literal ':' in query values and path segments (no
 * escaping), so we keep ':' and ',' raw for oracle friendliness; '#'
 * (structure tags in /locate) must still be percent-encoded or the URL
 * fragment would swallow it.
 */
export function buildQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeQueryValue(String(value))}`)
    .join("&");
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replaceAll("%3A", ":").replaceAll("%2C", ",");
}

// ---------------------------------------------------------------------------
// Structural checks (fail loudly on contract drift)
// ---------------------------------------------------------------------------

function expectRecord(value: unknown, ctx: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractViolationError(`${ctx}: expected a JSON object`);
  }
  return value as Record<string, unknown>;
}

function expectString(record: Record<string, unknown>, key: string, ctx: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ContractViolationError(`${ctx}: expected string "${key}", got ${typeof value}`);
  }
  return value;
}

function expectNumber(record: Record<string, unknown>, key: string, ctx: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractViolationError(`${ctx}: expected finite number "${key}", got ${typeof value}`);
  }
  return value;
}

function expectArray(record: Record<string, unknown>, key: string, ctx: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ContractViolationError(`${ctx}: expected array "${key}", got ${typeof value}`);
  }
  return value;
}

function expectStringArray(record: Record<string, unknown>, key: string, ctx: string): string[] {
  const value = expectArray(record, key, ctx);
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new ContractViolationError(`${ctx}: "${key}" must contain only strings`);
    }
  }
  return value as string[];
}

const PLACED_LEVELS: readonly PlacedLevel[] = ["grid", "biome_ok", "start_ok"];
const OVERLAY_KINDS: ReadonlySet<string> = new Set(["added", "replaced", "removed"]);

export function parseMeta(raw: unknown): OracleMeta {
  const ctx = "/meta";
  const record = expectRecord(raw, ctx);
  if (typeof record["seed"] === "number") {
    throw new ContractViolationError(
      `${ctx}: seed is a JSON number — the contract mandates strings (64-bit seeds lose precision as JS numbers)`,
    );
  }
  const overlayDiff = expectArray(record, "overlayDiff", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.overlayDiff[${i}]`);
    const kind = expectString(e, "kind", `${ctx}.overlayDiff[${i}]`);
    if (!OVERLAY_KINDS.has(kind)) {
      throw new ContractViolationError(`${ctx}.overlayDiff[${i}]: unknown kind "${kind}"`);
    }
    return { path: expectString(e, "path", `${ctx}.overlayDiff[${i}]`), kind: kind as OverlayDiffEntry["kind"] };
  });
  const mods = expectArray(record, "mods", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.mods[${i}]`);
    return {
      id: expectString(e, "id", `${ctx}.mods[${i}]`),
      version: expectString(e, "version", `${ctx}.mods[${i}]`),
      name: expectString(e, "name", `${ctx}.mods[${i}]`),
    };
  });
  return {
    mcVersion: expectString(record, "mcVersion", ctx),
    loaderVersion: expectString(record, "loaderVersion", ctx),
    oracleModVersion: expectString(record, "oracleModVersion", ctx),
    seed: expectString(record, "seed", ctx),
    packName: expectString(record, "packName", ctx),
    packVersion: expectString(record, "packVersion", ctx),
    packFingerprint: expectString(record, "packFingerprint", ctx),
    overlayDiff,
    dimensions: expectStringArray(record, "dimensions", ctx),
    mods,
  };
}

export function parseBiomeAnswer(raw: unknown): BiomeAnswer {
  const ctx = "/biome";
  const record = expectRecord(raw, ctx);
  return {
    dim: expectString(record, "dim", ctx),
    x: expectNumber(record, "x", ctx),
    y: expectNumber(record, "y", ctx),
    z: expectNumber(record, "z", ctx),
    biome: expectString(record, "biome", ctx),
  };
}

export function parseBiomesGrid(raw: unknown): BiomesGridResponse {
  const ctx = "/biomes/grid";
  const record = expectRecord(raw, ctx);
  const data = expectArray(record, "data", ctx);
  for (const entry of data) {
    if (typeof entry !== "number") {
      throw new ContractViolationError(`${ctx}: "data" must contain only numbers`);
    }
  }
  return {
    dim: expectString(record, "dim", ctx),
    y: expectNumber(record, "y", ctx),
    minX: expectNumber(record, "minX", ctx),
    minZ: expectNumber(record, "minZ", ctx),
    step: expectNumber(record, "step", ctx),
    w: expectNumber(record, "w", ctx),
    h: expectNumber(record, "h", ctx),
    palette: expectStringArray(record, "palette", ctx),
    data: data as number[],
  };
}

export function parseCandidates(raw: unknown): CandidatesResponse {
  const ctx = "/structures/candidates";
  const record = expectRecord(raw, ctx);
  const candidates = expectArray(record, "candidates", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.candidates[${i}]`);
    return {
      chunkX: expectNumber(e, "chunkX", `${ctx}.candidates[${i}]`),
      chunkZ: expectNumber(e, "chunkZ", `${ctx}.candidates[${i}]`),
      blockX: expectNumber(e, "blockX", `${ctx}.candidates[${i}]`),
      blockZ: expectNumber(e, "blockZ", `${ctx}.candidates[${i}]`),
    };
  });
  return {
    dim: expectString(record, "dim", ctx),
    structureSet: expectString(record, "structureSet", ctx),
    candidates,
  };
}

export function parsePlaced(raw: unknown): PlacedResponse {
  const ctx = "/structures/placed";
  const record = expectRecord(raw, ctx);
  const features = expectArray(record, "features", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.features[${i}]`);
    const level = expectString(e, "level", `${ctx}.features[${i}]`);
    if (!PLACED_LEVELS.includes(level as PlacedLevel)) {
      throw new ContractViolationError(`${ctx}.features[${i}]: unknown level "${level}"`);
    }
    return {
      id: expectString(e, "id", `${ctx}.features[${i}]`),
      structureSet: expectString(e, "structureSet", `${ctx}.features[${i}]`),
      x: expectNumber(e, "x", `${ctx}.features[${i}]`),
      z: expectNumber(e, "z", `${ctx}.features[${i}]`),
      chunkX: expectNumber(e, "chunkX", `${ctx}.features[${i}]`),
      chunkZ: expectNumber(e, "chunkZ", `${ctx}.features[${i}]`),
      level: level as PlacedLevel,
    };
  });
  return { dim: expectString(record, "dim", ctx), features };
}

export function parseLocateFound(raw: unknown): LocateResult {
  const ctx = "/locate";
  const record = expectRecord(raw, ctx);
  return {
    found: true,
    structure: expectString(record, "structure", ctx),
    x: expectNumber(record, "x", ctx),
    z: expectNumber(record, "z", ctx),
    distance: expectNumber(record, "distance", ctx),
  };
}

export function parseRegistryStructures(raw: unknown): RegistryStructure[] {
  const ctx = "/registry/structures";
  const record = expectRecord(raw, ctx);
  return expectArray(record, "structures", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.structures[${i}]`);
    return {
      id: expectString(e, "id", `${ctx}.structures[${i}]`),
      namespace: expectString(e, "namespace", `${ctx}.structures[${i}]`),
      sets: expectStringArray(e, "sets", `${ctx}.structures[${i}]`),
      dimensions: expectStringArray(e, "dimensions", `${ctx}.structures[${i}]`),
    };
  });
}

export function parseRegistryBiomes(raw: unknown): RegistryBiome[] {
  const ctx = "/registry/biomes";
  const record = expectRecord(raw, ctx);
  return expectArray(record, "biomes", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.biomes[${i}]`);
    return {
      id: expectString(e, "id", `${ctx}.biomes[${i}]`),
      namespace: expectString(e, "namespace", `${ctx}.biomes[${i}]`),
      color: expectString(e, "color", `${ctx}.biomes[${i}]`),
    };
  });
}

export function parseSeedVerify(raw: unknown): SeedVerifyResponse {
  const ctx = "/seed/verify";
  const record = expectRecord(raw, ctx);
  const results = expectArray(record, "results", ctx).map((entry, i) => {
    const e = expectRecord(entry, `${ctx}.results[${i}]`);
    return {
      seed: expectString(e, "seed", `${ctx}.results[${i}]`),
      matches: expectNumber(e, "matches", `${ctx}.results[${i}]`),
      total: expectNumber(e, "total", `${ctx}.results[${i}]`),
      verdict: expectString(e, "verdict", `${ctx}.results[${i}]`) as "match" | "mismatch",
      details: expectArray(e, "details", `${ctx}.results[${i}]`) as SeedVerifyDetail[],
    };
  });
  return { results };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

async function errorFromResponse(url: string, res: Response): Promise<OracleHttpError> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof parsed.error?.code === "string" ? parsed.error.code : `http_${res.status}`;
    const message = typeof parsed.error?.message === "string" ? parsed.error.message : text.slice(0, 200);
    return new OracleHttpError(url, res.status, code, message);
  } catch {
    return new OracleHttpError(url, res.status, `http_${res.status}`, text.slice(0, 200));
  }
}

export interface PlacedQueryOptions {
  types?: readonly string[];
  level?: PlacedLevel;
}

export class OracleClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl?: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async meta(): Promise<OracleMeta> {
    return parseMeta(await this.getJson("/meta"));
  }

  async biome(dim: string, x: number, y: number, z: number): Promise<BiomeAnswer> {
    return parseBiomeAnswer(await this.getJson(`/biome?${buildQuery({ dim, x, y, z })}`));
  }

  async biomesGrid(request: BiomesGridRequest): Promise<BiomesGridResponse> {
    return (await this.biomesGridRaw(request)).grid;
  }

  /** Raw body bytes too, for byte-identity checks in self-consistency. */
  async biomesGridRaw(request: BiomesGridRequest): Promise<{ bytes: Uint8Array; grid: BiomesGridResponse }> {
    const res = await this.request("/biomes/grid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const grid = parseBiomesGrid(JSON.parse(new TextDecoder().decode(bytes)));
    return { bytes, grid };
  }

  tilePath(dim: string, y: number, zoom: number, tx: number, tz: number): string {
    // Literal ':' is legal in path segments per the contract; dims contain no '/'.
    return `/tiles/${dim}/${y}/${zoom}/${tx}/${tz}.png`;
  }

  async tile(dim: string, y: number, zoom: number, tx: number, tz: number): Promise<TileResult> {
    const path = this.tilePath(dim, y, zoom, tx, tz);
    const started = performance.now();
    const res = await this.request(path);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const elapsedMs = performance.now() - started;
    return {
      path,
      bytes,
      elapsedMs,
      xCache: res.headers.get("X-Cache"),
      contentType: res.headers.get("Content-Type"),
    };
  }

  async structuresCandidates(dim: string, structureSet: string, box: BlockBox): Promise<CandidatesResponse> {
    const query = buildQuery({ dim, structureSet, minX: box.minX, minZ: box.minZ, maxX: box.maxX, maxZ: box.maxZ });
    return parseCandidates(await this.getJson(`/structures/candidates?${query}`));
  }

  structuresPlacedPath(dim: string, box: BlockBox, options: PlacedQueryOptions = {}): string {
    const params: Record<string, string | number> = {
      dim,
      minX: box.minX,
      minZ: box.minZ,
      maxX: box.maxX,
      maxZ: box.maxZ,
    };
    if (options.types !== undefined && options.types.length > 0) params["types"] = options.types.join(",");
    if (options.level !== undefined) params["level"] = options.level;
    return `/structures/placed?${buildQuery(params)}`;
  }

  async structuresPlaced(dim: string, box: BlockBox, options: PlacedQueryOptions = {}): Promise<PlacedResponse> {
    return parsePlaced(await this.getJson(this.structuresPlacedPath(dim, box, options)));
  }

  locatePath(dim: string, x: number, z: number, structure: string): string {
    return `/locate?${buildQuery({ dim, x, z, structure })}`;
  }

  /** 404 not_found (structure absent in range) is a result, not an error. */
  async locate(dim: string, x: number, z: number, structure: string): Promise<LocateResult> {
    try {
      return parseLocateFound(await this.getJson(this.locatePath(dim, x, z, structure)));
    } catch (err) {
      if (err instanceof OracleHttpError && err.status === 404 && err.code === "not_found") {
        return { found: false };
      }
      throw err;
    }
  }

  async registryStructures(): Promise<RegistryStructure[]> {
    return parseRegistryStructures(await this.getJson("/registry/structures"));
  }

  async registryBiomes(): Promise<RegistryBiome[]> {
    return parseRegistryBiomes(await this.getJson("/registry/biomes"));
  }

  async seedVerify(request: SeedVerifyRequest): Promise<SeedVerifyResponse> {
    const res = await this.request("/seed/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return parseSeedVerify(await res.json());
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = this.baseUrl + path;
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (cause) {
      throw new OracleUnreachableError(url, cause);
    }
    if (!res.ok) throw await errorFromResponse(url, res);
    return res;
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await this.request(path);
    return await res.json();
  }
}
