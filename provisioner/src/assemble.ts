import { copyFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./errors.js";
import {
  FABRIC_LAUNCH_JAR,
  FABRIC_LAUNCHER_PROPERTIES,
  PINS,
  SERVER_JAR,
} from "./pins.js";
import { computeFingerprint, isFingerprintPath } from "./core/fingerprint.js";
import { computeOverlayDiff, type OverlayDiffEntry, type OverlayFileHash } from "./core/overlay.js";
import type { RunManifest } from "./core/runManifest.js";
import { downloadToFile, type FetchLike } from "./io/fetcher.js";
import { fabricServerLauncherUrl } from "./io/fabric.js";
import { copyTree, ensureDir, pathExists, walkFiles } from "./io/fsx.js";
import { hashFile } from "./io/hash.js";
import { resolveMojangServerJar } from "./io/mojang.js";
import { extractZipSubtree, listZipEntries } from "./io/zip.js";

export interface RunDirs {
  runDir: string;
  serverDir: string;
  cacheDir: string;
  logsDir: string;
}

export function runDirs(runDir: string): RunDirs {
  const abs = path.resolve(runDir);
  return {
    runDir: abs,
    serverDir: path.join(abs, "server"),
    cacheDir: path.join(abs, "cache"),
    logsDir: path.join(abs, "logs"),
  };
}

export async function ensureRunLayout(dirs: RunDirs): Promise<void> {
  await ensureDir(dirs.serverDir);
  await ensureDir(dirs.cacheDir);
  await ensureDir(dirs.logsDir);
}

/**
 * Download the launcher pieces the server needs to boot:
 * - Mojang server jar (sha1-verified) as server.jar
 * - Fabric server launcher jar from meta.fabricmc.net as fabric-server-launch.jar
 * - fabric-server-launcher.properties pointing the launcher at server.jar
 * Idempotent: existing files are kept.
 */
export async function assembleServerBase(
  fetchImpl: FetchLike,
  serverDir: string,
  opts: { mcVersion: string; loaderVersion: string },
  log: (msg: string) => void,
): Promise<void> {
  await ensureDir(serverDir);

  const serverJarPath = path.join(serverDir, SERVER_JAR);
  if (!(await pathExists(serverJarPath))) {
    log(`Resolving Mojang server jar for ${opts.mcVersion} ...`);
    const jar = await resolveMojangServerJar(fetchImpl, opts.mcVersion);
    log(`Downloading server.jar (${(jar.size / 1024 / 1024).toFixed(1)} MB) ...`);
    await downloadToFile(fetchImpl, jar.url, serverJarPath, { sha1: jar.sha1 });
  }

  const launcherPath = path.join(serverDir, FABRIC_LAUNCH_JAR);
  if (!(await pathExists(launcherPath))) {
    log(`Downloading Fabric server launcher (loader ${opts.loaderVersion}, installer ${PINS.fabricInstaller}) ...`);
    const url = fabricServerLauncherUrl(opts.mcVersion, opts.loaderVersion, PINS.fabricInstaller);
    await downloadToFile(fetchImpl, url, launcherPath);
  }

  await writeFile(
    path.join(serverDir, FABRIC_LAUNCHER_PROPERTIES),
    `serverJar=${SERVER_JAR}\n`,
    "utf8",
  );
}

/** Package root (the directory containing package.json), from the compiled dist/ location. */
function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Locate the built oracle mod jar. Search order: explicit override,
 * SEEDMAP_ORACLE_JAR, then oracle-mod/build/libs relative to the repo root
 * (next to this package) and to the current working directory.
 */
export async function findOracleJar(override?: string): Promise<string> {
  const candidates: string[] = [];
  if (override !== undefined) {
    if (!(await pathExists(override))) {
      throw new UserError(`--oracle-jar ${override} does not exist.`);
    }
    return path.resolve(override);
  }
  const envJar = process.env.SEEDMAP_ORACLE_JAR;
  if (envJar !== undefined && envJar !== "") {
    if (!(await pathExists(envJar))) {
      throw new UserError(`SEEDMAP_ORACLE_JAR=${envJar} does not exist.`);
    }
    return path.resolve(envJar);
  }

  const libDirs = [
    path.resolve(packageRoot(), "..", "oracle-mod", "build", "libs"),
    path.resolve(process.cwd(), "oracle-mod", "build", "libs"),
  ];
  for (const dir of libDirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    const jars = entries.filter(
      (f) =>
        f.endsWith(".jar") &&
        !f.endsWith("-sources.jar") &&
        !f.endsWith("-dev.jar") &&
        !f.endsWith("-javadoc.jar"),
    );
    if (jars.length === 0) continue;
    const stats = await Promise.all(
      jars.map(async (f) => ({ f, mtime: (await stat(path.join(dir, f))).mtimeMs })),
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    candidates.push(path.join(dir, stats[0]!.f));
  }
  if (candidates.length === 0) {
    throw new UserError(
      "Oracle mod jar not found. Build it first:\n" +
        "  cd oracle-mod && ./gradlew build\n" +
        "or point at a jar explicitly with --oracle-jar <path> (or SEEDMAP_ORACLE_JAR).",
    );
  }
  return candidates[0]!;
}

/** Copy the oracle jar into server/mods; returns its path relative to serverDir. */
export async function injectOracleJar(serverDir: string, oracleJarPath: string): Promise<string> {
  const modsDir = path.join(serverDir, "mods");
  await ensureDir(modsDir);
  const name = path.basename(oracleJarPath);
  await copyFile(oracleJarPath, path.join(modsDir, name));
  return `mods/${name}`;
}

export interface FingerprintResult {
  fingerprint: string;
  files: { path: string; sha512: string }[];
}

/**
 * Hash every file under mods/, config/, world/datapacks/ in the server dir
 * and compute the pack fingerprint per docs/oracle-api.md. Must run BEFORE
 * the overlay is applied (overlay drift is reported separately).
 */
export async function computeServerFingerprint(serverDir: string): Promise<FingerprintResult> {
  const all = await walkFiles(serverDir);
  const relevant = all.filter(isFingerprintPath);
  const files: { path: string; sha512: string }[] = [];
  for (const rel of relevant) {
    files.push({ path: rel, sha512: await hashFile(path.join(serverDir, ...rel.split("/")), "sha512") });
  }
  return { fingerprint: computeFingerprint(files), files };
}

/**
 * Apply a user overlay (zip or dir mirroring the server layout) LAST, and
 * report the drift vs the pre-overlay state.
 */
export async function applyOverlay(serverDir: string, overlayPath: string): Promise<OverlayDiffEntry[]> {
  const abs = path.resolve(overlayPath);
  if (!(await pathExists(abs))) {
    throw new UserError(`Overlay ${overlayPath} does not exist.`);
  }

  const isZip = (await stat(abs)).isFile();
  let overlayRels: string[];
  const hashBefore = new Map<string, string>();

  if (isZip) {
    overlayRels = (await listZipEntries(abs)).filter((n) => !n.endsWith("/"));
  } else {
    overlayRels = await walkFiles(abs);
  }
  for (const rel of overlayRels) {
    const target = path.join(serverDir, ...rel.split("/"));
    if (await pathExists(target)) hashBefore.set(rel, await hashFile(target, "sha512"));
  }

  if (isZip) {
    await extractZipSubtree(abs, serverDir);
  } else {
    await copyTree(abs, serverDir);
  }

  const overlayHashes: OverlayFileHash[] = [];
  for (const rel of overlayRels) {
    overlayHashes.push({
      path: rel,
      sha512: await hashFile(path.join(serverDir, ...rel.split("/")), "sha512"),
    });
  }
  return computeOverlayDiff(hashBefore, overlayHashes);
}

export async function writeRunManifest(runDir: string, manifest: RunManifest): Promise<void> {
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
