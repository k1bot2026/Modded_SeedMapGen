import { spawn } from "node:child_process";
import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UserError } from "../errors.js";
import { ADOPTIUM_API } from "../pins.js";
import { javaExecutableName } from "../core/javaVersion.js";
import { downloadToFile, fetchJson, type FetchLike } from "./fetcher.js";
import { ensureDir, pathExists } from "./fsx.js";
import { extractZipSubtree } from "./zip.js";

export interface TemurinAsset {
  url: string;
  sha256?: string;
  name: string;
  releaseName: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function adoptiumOs(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "windows";
  return "linux";
}

export function adoptiumArch(arch: string = process.arch): string {
  if (arch === "arm64") return "aarch64";
  if (arch === "x64") return "x64";
  throw new UserError(`No Temurin 21 JRE is published for CPU architecture "${arch}".`);
}

/** Resolve the latest Temurin 21 JRE asset for this OS/arch via api.adoptium.net. */
export async function resolveTemurinJre(
  fetchImpl: FetchLike,
  opts: { os: string; arch: string },
): Promise<TemurinAsset> {
  const url =
    `${ADOPTIUM_API}/v3/assets/latest/21/hotspot` +
    `?architecture=${encodeURIComponent(opts.arch)}&image_type=jre&os=${encodeURIComponent(opts.os)}&vendor=eclipse`;
  const json = await fetchJson(fetchImpl, url);
  if (!Array.isArray(json) || json.length === 0) {
    throw new UserError(`Adoptium returned no Temurin 21 JRE for os=${opts.os} arch=${opts.arch}.`);
  }
  const entry = json
    .filter(isRecord)
    .find((e) => isRecord(e.binary) && isRecord(e.binary.package));
  if (!entry || !isRecord(entry.binary) || !isRecord(entry.binary.package)) {
    throw new UserError("Unexpected Adoptium assets response.");
  }
  const pkg = entry.binary.package;
  if (typeof pkg.link !== "string" || typeof pkg.name !== "string") {
    throw new UserError("Adoptium asset entry lacks a package link.");
  }
  const asset: TemurinAsset = {
    url: pkg.link,
    name: pkg.name,
    releaseName: typeof entry.release_name === "string" ? entry.release_name : "temurin-21",
  };
  if (typeof pkg.checksum === "string") asset.sha256 = pkg.checksum;
  return asset;
}

async function extractTarGz(archive: string, destDir: string): Promise<void> {
  // tar ships with macOS, Linux, and Windows 10+; the .tar.gz path is only
  // taken on macOS/Linux (Windows assets are zips).
  await ensureDir(destDir);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", destDir], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new UserError(`tar extraction failed (exit ${code}): ${stderr.slice(0, 400)}`));
    });
  });
}

/** Find the dir containing bin/java under an extracted JRE archive. */
async function findJavaHome(root: string, platform: NodeJS.Platform): Promise<string | null> {
  const exe = javaExecutableName(platform);
  if (await pathExists(path.join(root, "bin", exe))) return root;
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    for (const probe of [
      path.join(root, entry),
      path.join(root, entry, "Contents", "Home"),
    ]) {
      if (await pathExists(path.join(probe, "bin", exe))) return probe;
    }
  }
  return null;
}

/**
 * Download and install a Temurin 21 JRE into <destDir> (usually
 * <seedmapHome>/jre). Returns the java home path (contains bin/java).
 */
export async function installTemurinJre(
  fetchImpl: FetchLike,
  destDir: string,
  log: (msg: string) => void,
): Promise<string> {
  const asset = await resolveTemurinJre(fetchImpl, { os: adoptiumOs(), arch: adoptiumArch() });
  log(`Downloading ${asset.name} (${asset.releaseName}) ...`);

  const staging = await mkdtemp(path.join(os.tmpdir(), "seedmap-jre-"));
  try {
    const archive = path.join(staging, asset.name);
    const expected = asset.sha256 !== undefined ? { sha256: asset.sha256 } : {};
    await downloadToFile(fetchImpl, asset.url, archive, expected);

    const unpacked = path.join(staging, "unpacked");
    if (asset.name.toLowerCase().endsWith(".zip")) {
      await extractZipSubtree(archive, unpacked);
    } else {
      await extractTarGz(archive, unpacked);
    }
    const javaHome = await findJavaHome(unpacked, process.platform);
    if (javaHome === null) {
      throw new UserError("Extracted Temurin archive does not contain bin/java.");
    }

    await rm(destDir, { recursive: true, force: true });
    await ensureDir(path.dirname(destDir));
    try {
      await rename(javaHome, destDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      // tmpdir on a different filesystem: fall back to a copy.
      const { copyTree } = await import("./fsx.js");
      await ensureDir(destDir);
      await copyTree(javaHome, destDir);
    }
    if (process.platform !== "win32") {
      const { chmod } = await import("node:fs/promises");
      await chmod(path.join(destDir, "bin", javaExecutableName(process.platform)), 0o755).catch(() => undefined);
    }
    log(`Installed Temurin 21 JRE into ${destDir}`);
    return destDir;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
