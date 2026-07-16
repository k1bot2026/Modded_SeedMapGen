import { UserError } from "../errors.js";
import { normalizeRelPath } from "./paths.js";

export interface CfManifestFile {
  projectID: number;
  fileID: number;
  required: boolean;
}

export interface CfManifest {
  name: string;
  version: string;
  mcVersion: string;
  /** Loader version parsed from the primary "fabric-x.y.z" modLoader id. */
  fabricLoaderVersion: string;
  files: CfManifestFile[];
  /** Directory inside the zip whose contents overlay the instance ("overrides"). */
  overridesDir: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse and validate a CurseForge modpack manifest.json. Pure, no IO. */
export function parseCfManifest(json: unknown): CfManifest {
  if (!isRecord(json)) throw new UserError("Invalid manifest.json: not a JSON object.");
  if (json.manifestType !== "minecraftModpack") {
    throw new UserError(
      `Unsupported manifestType ${JSON.stringify(json.manifestType)} (expected "minecraftModpack").`,
    );
  }
  const name = typeof json.name === "string" && json.name !== "" ? json.name : "curseforge-pack";
  const version = typeof json.version === "string" ? json.version : "unknown";

  const minecraft = json.minecraft;
  if (!isRecord(minecraft) || typeof minecraft.version !== "string") {
    throw new UserError("Invalid manifest.json: missing minecraft.version.");
  }
  const loaders = Array.isArray(minecraft.modLoaders) ? minecraft.modLoaders : [];
  const loaderIds = loaders
    .filter(isRecord)
    .map((l) => ({ id: typeof l.id === "string" ? l.id : "", primary: l.primary === true }));
  const fabric =
    loaderIds.find((l) => l.primary && l.id.startsWith("fabric-")) ??
    loaderIds.find((l) => l.id.startsWith("fabric-"));
  if (!fabric) {
    const listed = loaderIds.map((l) => l.id).join(", ") || "(none)";
    throw new UserError(
      `Pack "${name}" does not declare a Fabric mod loader (found: ${listed}). Only Fabric packs are supported.`,
    );
  }
  const fabricLoaderVersion = fabric.id.slice("fabric-".length);

  const rawFiles = Array.isArray(json.files) ? json.files : [];
  const files: CfManifestFile[] = rawFiles.map((raw, i) => {
    if (!isRecord(raw) || typeof raw.projectID !== "number" || typeof raw.fileID !== "number") {
      throw new UserError(`Invalid manifest.json: files[${i}] lacks numeric projectID/fileID.`);
    }
    return { projectID: raw.projectID, fileID: raw.fileID, required: raw.required !== false };
  });

  const overridesDir =
    typeof json.overrides === "string" && json.overrides !== ""
      ? normalizeRelPath(json.overrides).replace(/\/$/, "")
      : "overrides";

  return { name, version, mcVersion: minecraft.version, fabricLoaderVersion, files, overridesDir };
}

export type CfZipKind =
  | { kind: "manifest"; root: string }
  | { kind: "serverpack"; root: string };

/**
 * Server-pack heuristic (per spec): a zip with a mods/ directory and no
 * manifest.json is an already-assembled server pack — extract it wholesale.
 * Tolerates a single wrapping top-level directory.
 */
export function detectCurseforgeZipKind(entryNames: readonly string[]): CfZipKind {
  const names = entryNames.map((n) => normalizeRelPath(n));
  const hasAtRoot = (probe: string): boolean =>
    names.some((n) => n === probe || n.startsWith(`${probe}/`) || n === `${probe}/`);

  if (names.includes("manifest.json")) return { kind: "manifest", root: "" };
  if (hasAtRoot("mods")) return { kind: "serverpack", root: "" };

  // Single common top-level directory?
  const tops = new Set(names.map((n) => n.split("/")[0]).filter((t): t is string => t !== undefined && t !== ""));
  if (tops.size === 1) {
    const top = [...tops][0]!;
    if (names.includes(`${top}/manifest.json`)) return { kind: "manifest", root: `${top}/` };
    if (names.some((n) => n.startsWith(`${top}/mods/`) || n === `${top}/mods/`)) {
      return { kind: "serverpack", root: `${top}/` };
    }
  }
  throw new UserError(
    "Unrecognized CurseForge zip: no manifest.json and no mods/ directory found " +
      "(neither at the zip root nor under a single top-level folder).",
  );
}
