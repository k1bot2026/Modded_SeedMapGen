import { UserError } from "../errors.js";
import type { OverlayDiffEntry } from "./overlay.js";

export type PackSource = "modrinth" | "curseforge" | "vanilla" | "local";

export interface RunManifest {
  schema: 1;
  createdAt: string;
  pack: {
    source: PackSource;
    /** Slug/URL/file path/dir the user provisioned from. */
    ref: string;
    /** Modrinth version id, when provisioned from Modrinth. */
    versionId?: string;
  };
  packName: string;
  /** The pinned pack version (never "latest"). */
  packVersion: string;
  mcVersion: string;
  loaderVersion: string;
  packFingerprint: string;
  /** Fingerprint inputs: every file under mods/, config/, world/datapacks/ (pre-overlay). */
  files: { path: string; sha512: string }[];
  overlayDiff: OverlayDiffEntry[];
  /** Relative path (within server/) of the injected oracle mod jar. */
  oracleJar: string;
  /** Seed read from a local pack's server.properties, if any. */
  defaultSeed?: string;
}

export function parseRunManifest(json: unknown): RunManifest {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new UserError("Invalid run.json: not a JSON object.");
  }
  const m = json as Partial<RunManifest>;
  if (m.schema !== 1) {
    throw new UserError(`Unsupported run.json schema ${JSON.stringify(m.schema)} (expected 1).`);
  }
  for (const key of [
    "createdAt",
    "packName",
    "packVersion",
    "mcVersion",
    "loaderVersion",
    "packFingerprint",
    "oracleJar",
  ] as const) {
    if (typeof m[key] !== "string") {
      throw new UserError(`Invalid run.json: missing "${key}". Re-run \`seedmap provision\`.`);
    }
  }
  if (typeof m.pack !== "object" || m.pack === null) {
    throw new UserError('Invalid run.json: missing "pack".');
  }
  if (!Array.isArray(m.files) || !Array.isArray(m.overlayDiff)) {
    throw new UserError('Invalid run.json: missing "files"/"overlayDiff".');
  }
  return m as RunManifest;
}
