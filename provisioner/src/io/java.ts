import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  javaCandidates,
  javaExecutableName,
  parseJavaVersionOutput,
  type JavaSearchEnv,
} from "../core/javaVersion.js";
import { pathExists } from "./fsx.js";

const execFileAsync = promisify(execFile);

export interface JavaInstall {
  javaBin: string;
  version: string;
  major: number;
  source: string;
}

/** Root for seedmap-owned files (auto-downloaded JRE lives at <home>/jre). */
export function seedmapHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SEEDMAP_HOME;
  if (override !== undefined && override !== "") return override;
  return path.join(os.homedir(), ".seedmap");
}

export function defaultJavaSearchEnv(): JavaSearchEnv {
  const env: JavaSearchEnv = {
    platform: process.platform,
    homeDir: os.homedir(),
    seedmapHome: seedmapHome(),
  };
  if (process.env.JAVA_HOME !== undefined && process.env.JAVA_HOME !== "") {
    env.javaHome = process.env.JAVA_HOME;
  }
  return env;
}

/** Run `<javaBin> -version` and parse the reported version. */
export async function probeJava(javaBin: string, source: string): Promise<JavaInstall | null> {
  try {
    // Version info famously goes to stderr.
    const { stdout, stderr } = await execFileAsync(javaBin, ["-version"], { timeout: 15_000 });
    const parsed = parseJavaVersionOutput(`${stderr}\n${stdout}`);
    if (!parsed) return null;
    return { javaBin, version: parsed.version, major: parsed.major, source };
  } catch {
    return null;
  }
}

/**
 * Find java executables inside an installs dir, looking at <dir>/bin/java,
 * <install>/bin/java and (macOS) <install>/Contents/Home/bin/java one level deep.
 */
async function scanInstallDir(dir: string, platform: NodeJS.Platform): Promise<string[]> {
  const exe = javaExecutableName(platform);
  const found: string[] = [];
  const direct = path.join(dir, "bin", exe);
  if (await pathExists(direct)) found.push(direct);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    for (const suffix of [["bin", exe], ["Contents", "Home", "bin", exe]]) {
      const candidate = path.join(dir, entry, ...suffix);
      if (await pathExists(candidate)) found.push(candidate);
    }
  }
  return found;
}

/**
 * Discover Java installs in priority order: seedmap-managed JRE, JAVA_HOME,
 * PATH, then common per-OS install roots. Deduplicated by executable path.
 */
export async function discoverJava(env: JavaSearchEnv = defaultJavaSearchEnv()): Promise<JavaInstall[]> {
  const seen = new Set<string>();
  const installs: JavaInstall[] = [];
  for (const candidate of javaCandidates(env)) {
    const bins =
      candidate.kind === "exe" ? [candidate.path] : await scanInstallDir(candidate.path, env.platform);
    for (const bin of bins) {
      const key = path.resolve(bin);
      if (seen.has(key)) continue;
      seen.add(key);
      const install = await probeJava(bin, candidate.source);
      if (install) installs.push(install);
    }
  }
  return installs;
}

/** First discovered install with major >= minMajor (MC 1.21.1 needs 21). */
export async function findJava(minMajor = 21, env?: JavaSearchEnv): Promise<JavaInstall | null> {
  const installs = await discoverJava(env);
  return installs.find((i) => i.major >= minMajor) ?? null;
}
