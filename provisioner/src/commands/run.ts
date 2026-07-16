import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.js";
import { DEFAULT_HEAP, DEFAULT_ORACLE_PORT, FABRIC_LAUNCH_JAR, ORACLE_WORLD_NAME, SERVER_JAR } from "../pins.js";
import { EULA_REFUSAL_MESSAGE, eulaFileContent, resolveEula } from "../core/eula.js";
import { buildOracleConfig } from "../core/oracleConfig.js";
import { parseRunManifest, type RunManifest } from "../core/runManifest.js";
import { parseSeed } from "../core/seed.js";
import { mergeServerProperties, oracleServerProperties } from "../core/serverProperties.js";
import { assembleServerBase, findOracleJar, injectOracleJar, runDirs, writeRunManifest } from "../assemble.js";
import type { FetchLike } from "../io/fetcher.js";
import { ensureDir, pathExists, readTextIfExists } from "../io/fsx.js";
import { findJava } from "../io/java.js";
import { sleep, type Logger } from "../util.js";

export interface RunOptions {
  seed?: string;
  port?: string;
  heap?: string;
  acceptEula?: boolean;
  dim?: string[];
  oracleJar?: string;
}

async function loadManifest(runDir: string): Promise<RunManifest> {
  const raw = await readTextIfExists(path.join(runDir, "run.json"));
  if (raw === null) {
    throw new UserError(
      `${runDir} is not a provisioned run directory (no run.json). Run \`seedmap provision\` first.`,
    );
  }
  return parseRunManifest(JSON.parse(raw));
}

/** Complete any assembly pieces provisioning deferred (or that went missing). */
async function ensureAssembled(
  manifest: RunManifest,
  runDir: string,
  serverDir: string,
  fetchImpl: FetchLike,
  log: Logger,
  oracleJarOverride?: string,
): Promise<void> {
  const missingBase =
    !(await pathExists(path.join(serverDir, SERVER_JAR))) ||
    !(await pathExists(path.join(serverDir, FABRIC_LAUNCH_JAR)));
  if (missingBase) {
    log("Launcher pieces missing — completing server assembly ...");
    await assembleServerBase(
      fetchImpl,
      serverDir,
      { mcVersion: manifest.mcVersion, loaderVersion: manifest.loaderVersion },
      log,
    );
  }
  if (!(await pathExists(path.join(serverDir, ...manifest.oracleJar.split("/"))))) {
    log("Oracle mod jar missing — re-injecting ...");
    const jar = await findOracleJar(oracleJarOverride);
    manifest.oracleJar = await injectOracleJar(serverDir, jar);
    await writeRunManifest(runDir, manifest);
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_ORACLE_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UserError(`Invalid --port ${raw}.`);
  }
  return port;
}

function validateHeap(raw: string | undefined): string {
  const heap = raw ?? DEFAULT_HEAP;
  if (!/^\d+[kKmMgG]?$/.test(heap)) {
    throw new UserError(`Invalid --heap ${JSON.stringify(heap)} (expected e.g. 4G, 2048M).`);
  }
  return heap;
}

/**
 * Poll GET /meta until 200. `aborted` (child died) stops the loop promptly —
 * otherwise its timers would keep the process alive after a launch failure.
 */
async function pollMeta(
  port: number,
  timeoutMs: number,
  log: Logger,
  aborted: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastNote = 0;
  while (Date.now() < deadline && !aborted()) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/meta`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() - lastNote > 30_000) {
      log(`  waiting for oracle on port ${port} ...`);
      lastNote = Date.now();
    }
    if (aborted()) return false;
    await sleep(2000);
  }
  return false;
}

function stopChildGracefully(child: ChildProcess, log: Logger): void {
  log("Stopping server (sending \"stop\") ...");
  try {
    child.stdin?.write("stop\n");
  } catch {
    child.kill("SIGTERM");
    return;
  }
  const term = setTimeout(() => {
    log("Server still running after 20s — sending SIGTERM.");
    child.kill("SIGTERM");
  }, 20_000);
  const kill = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.once("exit", () => {
    clearTimeout(term);
    clearTimeout(kill);
  });
}

/** `seedmap run <runDir> --seed <seed>` — boot the oracle and stay attached. */
export async function runCommand(
  runDirRef: string,
  opts: RunOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<never> {
  const dirs = runDirs(runDirRef);
  const manifest = await loadManifest(dirs.runDir);

  const seedInput = opts.seed ?? manifest.defaultSeed;
  if (seedInput === undefined) {
    throw new UserError("--seed is required (run /seed in-game to get the world seed).");
  }
  const seed = parseSeed(seedInput);
  if (opts.seed === undefined) log(`Using default seed from provisioning: ${seed}`);
  const port = parsePort(opts.port);
  const heap = validateHeap(opts.heap);

  await ensureAssembled(manifest, dirs.runDir, dirs.serverDir, fetchImpl, log, opts.oracleJar);

  // EULA gate: eula.txt is only ever written on an explicit --accept-eula.
  const existingEula = await readTextIfExists(path.join(dirs.serverDir, "eula.txt"));
  const eula = resolveEula(existingEula, opts.acceptEula === true);
  if (!eula.accepted) throw new UserError(EULA_REFUSAL_MESSAGE);
  if (eula.write) {
    await writeFile(path.join(dirs.serverDir, "eula.txt"), eulaFileContent(new Date()), "utf8");
  }

  // level-seed only applies at world creation: a stale throwaway world would
  // silently pin the previous seed, so it is always removed.
  await rm(path.join(dirs.serverDir, ORACLE_WORLD_NAME), { recursive: true, force: true });

  const propsPath = path.join(dirs.serverDir, "server.properties");
  const existingProps = await readTextIfExists(propsPath);
  await writeFile(propsPath, mergeServerProperties(existingProps, oracleServerProperties(seed)), "utf8");

  await ensureDir(path.join(dirs.serverDir, "config"));
  const oracleConfig = buildOracleConfig({
    port,
    packName: manifest.packName,
    packVersion: manifest.packVersion,
    packFingerprint: manifest.packFingerprint,
    cacheDir: dirs.cacheDir,
    overlayDiff: manifest.overlayDiff,
    ...(opts.dim !== undefined && opts.dim.length > 0 ? { dimensions: opts.dim } : {}),
  });
  await writeFile(
    path.join(dirs.serverDir, "config", "seedmap-oracle.json"),
    JSON.stringify(oracleConfig, null, 2) + "\n",
    "utf8",
  );

  const java = await findJava(21);
  if (java === null) {
    throw new UserError(
      "No Java 21+ runtime found (checked JAVA_HOME, PATH, and common install locations).\n" +
        "Run `seedmap doctor` — it can download a Temurin 21 JRE for you.",
    );
  }
  log(`Java ${java.version} (${java.source}): ${java.javaBin}`);

  await ensureDir(dirs.logsDir);
  const logFile = path.join(dirs.logsDir, "server.log");
  const logStream = createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n===== seedmap run ${new Date().toISOString()} seed=${seed} port=${port} =====\n`);

  log(`Launching: ${java.javaBin} -Xmx${heap} -jar ${FABRIC_LAUNCH_JAR} nogui`);
  log(`  cwd  ${dirs.serverDir}`);
  log(`  logs ${logFile}`);
  const child = spawn(java.javaBin, [`-Xmx${heap}`, "-jar", FABRIC_LAUNCH_JAR, "nogui"], {
    cwd: dirs.serverDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let stopping = false;
  const onSigint = (): void => {
    if (stopping) {
      child.kill("SIGTERM");
      return;
    }
    stopping = true;
    stopChildGracefully(child, log);
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  let childExited = false;
  const exitPromise = new Promise<number>((resolve) => {
    child.once("exit", (code) => {
      childExited = true;
      resolve(code ?? 0);
    });
  });

  child.once("spawn", () => log("Server process started; waiting for the oracle to come up ..."));

  const raceResult = await Promise.race([
    pollMeta(port, 5 * 60_000, log, () => childExited).then((ok) => ({ kind: "health" as const, ok })),
    exitPromise.then((code) => ({ kind: "exit" as const, code })),
  ]);

  if (raceResult.kind === "exit") {
    logStream.end();
    const tail = (await readFile(logFile, "utf8").catch(() => "")).split("\n").slice(-30).join("\n");
    throw new UserError(
      `Server exited (code ${raceResult.code}) before the oracle came up. Last log lines:\n${tail}\n` +
        `Full log: ${logFile}`,
      raceResult.code === 0 ? 1 : raceResult.code,
    );
  }
  if (!raceResult.ok) {
    stopChildGracefully(child, log);
    await exitPromise;
    logStream.end();
    throw new UserError(`Oracle did not answer /meta within 5 minutes. See ${logFile}.`);
  }

  log("");
  log("Oracle is up.");
  log(`  pack        ${manifest.packName} ${manifest.packVersion}`);
  log(`  fingerprint ${manifest.packFingerprint}`);
  log(`  seed        ${seed}`);
  log(`  meta        http://127.0.0.1:${port}/meta`);
  log("");
  log(`Map UI: run \`pnpm --dir webapp dev\` and open http://localhost:5173/?port=${port}`);
  log("Press Ctrl+C to stop the server.");

  const code = await exitPromise;
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigint);
  logStream.end();
  log(`Server exited (code ${code}).`);
  process.exit(code);
}
