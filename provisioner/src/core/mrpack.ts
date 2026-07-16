import { UserError } from "../errors.js";
import { isSafeRelPath, normalizeRelPath } from "./paths.js";

export type EnvSupport = "required" | "optional" | "unsupported";

export interface MrpackFile {
  /** Normalized path relative to the instance dir, e.g. "mods/foo.jar". */
  path: string;
  sha512: string;
  sha1?: string;
  downloads: string[];
  fileSize?: number;
  envServer: EnvSupport;
}

export interface ParsedMrpack {
  name: string;
  /** The pack's own version string (modrinth.index.json `versionId`). */
  versionId: string;
  summary?: string;
  mcVersion: string;
  /** Fabric loader version declared by the pack, if any. */
  fabricLoaderVersion?: string;
  /** Files to install on the server (env.server != "unsupported"). */
  files: MrpackFile[];
  /** Entries skipped because the server does not support them. */
  skipped: { path: string; reason: string }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new UserError(`Invalid modrinth.index.json: ${ctx}: missing or non-string "${key}".`);
  }
  return v;
}

const ENV_VALUES: readonly EnvSupport[] = ["required", "optional", "unsupported"];

/**
 * Parse and validate a modrinth.index.json document (Modrinth pack format v1).
 * Pure: takes the already-parsed JSON value, no IO.
 */
export function parseMrpackIndex(json: unknown): ParsedMrpack {
  if (!isRecord(json)) {
    throw new UserError("Invalid modrinth.index.json: not a JSON object.");
  }
  if (json.formatVersion !== 1) {
    throw new UserError(
      `Unsupported mrpack formatVersion ${JSON.stringify(json.formatVersion)} (expected 1).`,
    );
  }
  if (json.game !== "minecraft") {
    throw new UserError(`Unsupported mrpack game ${JSON.stringify(json.game)} (expected "minecraft").`);
  }
  const name = reqString(json, "name", "pack");
  const versionId = reqString(json, "versionId", "pack");

  const deps = isRecord(json.dependencies) ? json.dependencies : {};
  for (const forbidden of ["forge", "neoforge", "quilt-loader"]) {
    if (typeof deps[forbidden] === "string") {
      throw new UserError(
        `Pack "${name}" requires loader "${forbidden}". Only Fabric packs are supported.`,
      );
    }
  }
  const mcVersion = deps["minecraft"];
  if (typeof mcVersion !== "string" || mcVersion.length === 0) {
    throw new UserError(`Pack "${name}" does not declare a "minecraft" dependency.`);
  }
  const fabricLoaderVersion =
    typeof deps["fabric-loader"] === "string" ? deps["fabric-loader"] : undefined;

  const rawFiles = json.files;
  if (!Array.isArray(rawFiles)) {
    throw new UserError('Invalid modrinth.index.json: "files" is not an array.');
  }

  const files: MrpackFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  rawFiles.forEach((raw, i) => {
    if (!isRecord(raw)) {
      throw new UserError(`Invalid modrinth.index.json: files[${i}] is not an object.`);
    }
    const rawPath = reqString(raw, "path", `files[${i}]`);
    const path = normalizeRelPath(rawPath);
    if (!isSafeRelPath(path)) {
      throw new UserError(
        `Refusing unsafe file path in modrinth.index.json: ${JSON.stringify(rawPath)}.`,
      );
    }
    const hashes = raw.hashes;
    if (!isRecord(hashes) || typeof hashes.sha512 !== "string") {
      throw new UserError(`Invalid modrinth.index.json: files[${i}] ("${path}") lacks a sha512 hash.`);
    }
    const downloads = raw.downloads;
    if (
      !Array.isArray(downloads) ||
      downloads.length === 0 ||
      !downloads.every((d): d is string => typeof d === "string")
    ) {
      throw new UserError(`Invalid modrinth.index.json: files[${i}] ("${path}") lacks download URLs.`);
    }

    let envServer: EnvSupport = "required";
    if (isRecord(raw.env)) {
      const server = raw.env.server;
      if (typeof server === "string") {
        if (!ENV_VALUES.includes(server as EnvSupport)) {
          throw new UserError(
            `Invalid modrinth.index.json: files[${i}] ("${path}") has unknown env.server ${JSON.stringify(server)}.`,
          );
        }
        envServer = server as EnvSupport;
      }
    }
    if (envServer === "unsupported") {
      skipped.push({ path, reason: 'env.server == "unsupported"' });
      return;
    }

    const file: MrpackFile = {
      path,
      sha512: hashes.sha512.toLowerCase(),
      downloads,
      envServer,
    };
    if (typeof hashes.sha1 === "string") file.sha1 = hashes.sha1.toLowerCase();
    if (typeof raw.fileSize === "number") file.fileSize = raw.fileSize;
    files.push(file);
  });

  const parsed: ParsedMrpack = { name, versionId, mcVersion, files, skipped };
  if (typeof json.summary === "string") parsed.summary = json.summary;
  if (fabricLoaderVersion !== undefined) parsed.fabricLoaderVersion = fabricLoaderVersion;
  return parsed;
}
