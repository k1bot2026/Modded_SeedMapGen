import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { FABRIC_LAUNCH_JAR, SERVER_JAR } from "../pins.js";
import { isEulaAccepted } from "../core/eula.js";
import { parseRunManifest } from "../core/runManifest.js";
import { installTemurinJre } from "../io/adoptium.js";
import type { FetchLike } from "../io/fetcher.js";
import { pathExists, readTextIfExists } from "../io/fsx.js";
import { discoverJava, probeJava, seedmapHome, type JavaInstall } from "../io/java.js";
import { javaExecutableName } from "../core/javaVersion.js";
import type { Logger } from "../util.js";

export interface DoctorOptions {
  /** --yes: skip the JRE download prompt. */
  yes?: boolean;
  /** commander --no-download => download === false: never download, print instructions. */
  download?: boolean;
}

const GB = 1024 ** 3;

async function checkJava(
  opts: DoctorOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<{ ok: boolean }> {
  log("Java");
  const installs = await discoverJava();
  let best: JavaInstall | null = null;
  if (installs.length === 0) {
    log("  no Java runtime found (checked seedmap JRE, JAVA_HOME, PATH, common install dirs).");
  }
  for (const install of installs) {
    const marker = install.major >= 21 ? "OK  " : "old ";
    log(`  ${marker} ${install.version.padEnd(12)} via ${install.source}: ${install.javaBin}`);
    if (best === null && install.major >= 21) best = install;
  }
  if (best !== null) return { ok: true };

  log("  Java 21+ is required (Minecraft 1.21.1).");
  if (opts.download === false) {
    log("  Install a Temurin 21 JRE manually: https://adoptium.net/temurin/releases/?version=21");
    log("  (or re-run `seedmap doctor` without --no-download to let it install one)");
    return { ok: false };
  }

  const jreDir = path.join(seedmapHome(), "jre");
  if (opts.yes !== true) {
    if (!process.stdin.isTTY) {
      log("  Non-interactive session: re-run with --yes to auto-download a Temurin 21 JRE,");
      log(`  or install one manually (it would go to ${jreDir}).`);
      return { ok: false };
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question(`  Download a Temurin 21 JRE from adoptium.net into ${jreDir}? [y/N] `)
    ).trim();
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      log("  Skipped. Install Java 21 manually or re-run with --yes.");
      return { ok: false };
    }
  }

  const javaHome = await installTemurinJre(fetchImpl, jreDir, (m) => log(`  ${m}`));
  const bin = path.join(javaHome, "bin", javaExecutableName(process.platform));
  const probed = await probeJava(bin, "seedmap-managed JRE");
  if (probed === null || probed.major < 21) {
    log("  Downloaded JRE failed the version probe — please report this.");
    return { ok: false };
  }
  log(`  OK   ${probed.version} via seedmap-managed JRE: ${probed.javaBin}`);
  return { ok: true };
}

async function checkRunDir(runDir: string, log: Logger): Promise<{ ok: boolean }> {
  log(`Run directory: ${runDir}`);
  let ok = true;
  const raw = await readTextIfExists(path.join(runDir, "run.json"));
  if (raw === null) {
    log("  FAIL run.json missing — not a provisioned run dir.");
    return { ok: false };
  }
  try {
    const manifest = parseRunManifest(JSON.parse(raw));
    log(`  OK   run.json: ${manifest.packName} ${manifest.packVersion} (${manifest.packFingerprint.slice(0, 20)}...)`);

    const serverDir = path.join(runDir, "server");
    for (const [label, rel] of [
      ["Mojang server jar", SERVER_JAR],
      ["Fabric launcher", FABRIC_LAUNCH_JAR],
      ["oracle mod jar", manifest.oracleJar],
    ] as const) {
      if (await pathExists(path.join(serverDir, ...rel.split("/")))) {
        log(`  OK   ${label}: server/${rel}`);
      } else {
        log(`  MISS ${label}: server/${rel} — \`seedmap run\` will fetch/inject it on next launch.`);
      }
    }

    const eula = isEulaAccepted(await readTextIfExists(path.join(serverDir, "eula.txt")));
    log(
      eula
        ? "  OK   eula.txt accepted."
        : "  --   eula.txt not accepted yet; `seedmap run` needs --accept-eula once.",
    );
  } catch (err) {
    log(`  FAIL ${(err as Error).message}`);
    ok = false;
  }
  return { ok };
}

/** `seedmap doctor [<runDir>]` — environment and run-dir health checks. */
export async function doctorCommand(
  runDirRef: string | undefined,
  opts: DoctorOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<number> {
  let ok = true;

  log("Node");
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 22) {
    log(`  OK   node ${process.versions.node}`);
  } else {
    log(`  FAIL node ${process.versions.node} — Node 22+ required.`);
    ok = false;
  }
  log("");

  const javaResult = await checkJava(opts, fetchImpl, log);
  ok = ok && javaResult.ok;
  log("");

  log("Memory");
  const totalGb = os.totalmem() / GB;
  const freeGb = os.freemem() / GB;
  log(`  total ${totalGb.toFixed(1)} GB, free ${freeGb.toFixed(1)} GB`);
  if (freeGb < 6) {
    log(
      "  WARN less than 6 GB free: the default heap (-Xmx4G) may not fit alongside your OS.\n" +
        "       Consider `seedmap run ... --heap 2G` for lighter packs.",
    );
  }
  log("");

  log("Disk");
  try {
    const fsStat = await statfs(process.cwd());
    const availGb = (fsStat.bavail * fsStat.bsize) / GB;
    log(`  ${availGb.toFixed(1)} GB available at ${process.cwd()}`);
    if (availGb < 5) {
      log("  WARN a provisioned run needs a few GB (server jar, mods, throwaway world, tile cache).");
    }
  } catch {
    log("  (could not determine free disk space)");
  }

  if (runDirRef !== undefined) {
    log("");
    const runResult = await checkRunDir(path.resolve(runDirRef), log);
    ok = ok && runResult.ok;
  }

  log("");
  log(ok ? "doctor: all checks passed." : "doctor: some checks FAILED (see above).");
  return ok ? 0 : 1;
}
