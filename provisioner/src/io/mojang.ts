import { UserError } from "../errors.js";
import { MOJANG_VERSION_MANIFEST } from "../pins.js";
import { fetchJson, type FetchLike } from "./fetcher.js";

export interface MojangServerJar {
  url: string;
  sha1: string;
  size: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Resolve the official server jar download for a Minecraft version:
 * version_manifest_v2.json -> per-version json -> downloads.server.
 */
export async function resolveMojangServerJar(fetchImpl: FetchLike, mcVersion: string): Promise<MojangServerJar> {
  const manifest = await fetchJson(fetchImpl, MOJANG_VERSION_MANIFEST);
  if (!isRecord(manifest) || !Array.isArray(manifest.versions)) {
    throw new UserError("Unexpected Mojang version manifest response.");
  }
  const entry = manifest.versions
    .filter(isRecord)
    .find((v) => v.id === mcVersion && typeof v.url === "string");
  if (!entry) {
    throw new UserError(`Minecraft version "${mcVersion}" not found in Mojang's version manifest.`);
  }

  const versionJson = await fetchJson(fetchImpl, entry.url as string);
  if (!isRecord(versionJson) || !isRecord(versionJson.downloads) || !isRecord(versionJson.downloads.server)) {
    throw new UserError(`Mojang version json for ${mcVersion} has no server download.`);
  }
  const server = versionJson.downloads.server;
  if (typeof server.url !== "string" || typeof server.sha1 !== "string") {
    throw new UserError(`Mojang server download entry for ${mcVersion} is malformed.`);
  }
  return { url: server.url, sha1: server.sha1, size: typeof server.size === "number" ? server.size : 0 };
}
