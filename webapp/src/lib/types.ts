/**
 * Types mirroring docs/oracle-api.md (the contract — do not deviate).
 * Seeds are strings end-to-end: Minecraft seeds are signed 64-bit longs and
 * JSON numbers lose precision above 2^53.
 */

export interface ModInfo {
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
  seed: string;
  packName: string;
  packVersion: string;
  packFingerprint: string;
  overlayDiff: OverlayDiffEntry[];
  dimensions: string[];
  mods: ModInfo[];
}

export interface BiomeResponse {
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
  /** Row-major: data[row * w + col] indexes palette; col runs along X, row along Z. */
  data: number[];
}

export type VerificationLevel = "grid" | "biome_ok" | "start_ok";

export interface PlacedFeature {
  id: string;
  structureSet: string;
  x: number;
  z: number;
  chunkX: number;
  chunkZ: number;
  level: VerificationLevel;
}

export interface StructuresPlacedResponse {
  dim: string;
  features: PlacedFeature[];
}

export interface StructureCandidate {
  chunkX: number;
  chunkZ: number;
  blockX: number;
  blockZ: number;
}

export interface StructuresCandidatesResponse {
  dim: string;
  structureSet: string;
  candidates: StructureCandidate[];
}

export interface LocateResponse {
  structure: string;
  x: number;
  z: number;
  distance: number;
}

export interface StructureRegistryEntry {
  id: string;
  namespace: string;
  sets: string[];
  dimensions: string[];
}

export interface RegistryStructuresResponse {
  structures: StructureRegistryEntry[];
}

export interface BiomeRegistryEntry {
  id: string;
  namespace: string;
  /** Hex color, no alpha — exact tile-palette color. */
  color: string;
}

export interface RegistryBiomesResponse {
  biomes: BiomeRegistryEntry[];
}

export type SeedObservation =
  | { type: "biome"; dim: string; x: number; y: number; z: number; expected: string }
  | { type: "structure"; dim: string; x: number; z: number; expected: string }
  | { type: "bedrock"; dim: string; x: number; y: number; z: number; expected: string };

export interface SeedVerifyRequest {
  candidates: string[];
  observations: SeedObservation[];
}

export interface SeedVerifyDetail {
  index: number;
  match: boolean | null;
  actual?: string;
  unsupported?: boolean;
}

export interface SeedVerifyResult {
  seed: string;
  matches: number;
  total: number;
  verdict: "match" | "mismatch";
  details: SeedVerifyDetail[];
}

export interface SeedVerifyResponse {
  results: SeedVerifyResult[];
}

export interface OracleErrorBody {
  error: { code: string; message: string };
}
