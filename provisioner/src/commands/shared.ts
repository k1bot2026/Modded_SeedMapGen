import {
  applyOverlay,
  assembleServerBase,
  computeServerFingerprint,
  ensureRunLayout,
  findOracleJar,
  injectOracleJar,
  runDirs,
  writeRunManifest,
  type RunDirs,
} from "../assemble.js";
import type { OverlayDiffEntry } from "../core/overlay.js";
import type { PackSource, RunManifest } from "../core/runManifest.js";
import type { FetchLike } from "../io/fetcher.js";
import { PINS } from "../pins.js";
import type { Logger } from "../util.js";

/** Directory-name-safe slug for default --out paths. */
export function sanitizeName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s === "" ? "pack" : s;
}

export interface FinalizeOptions {
  fetchImpl: FetchLike;
  dirs: RunDirs;
  log: Logger;
  pack: { source: PackSource; ref: string; versionId?: string };
  packName: string;
  packVersion: string;
  mcVersion: string;
  loaderVersion: string;
  oracleJar?: string;
  overlay?: string;
  defaultSeed?: string;
}

/**
 * Steps every provision flow shares once pack content sits in server/:
 * launcher pieces -> oracle jar -> fingerprint (pre-overlay) -> overlay+diff
 * -> run.json.
 */
export async function finalizeProvision(opts: FinalizeOptions): Promise<RunManifest> {
  const { dirs, log } = opts;

  if (opts.mcVersion !== PINS.minecraft) {
    log(
      `WARNING: pack targets Minecraft ${opts.mcVersion}, but this tool is validated against ` +
        `${PINS.minecraft} only. Proceeding — expect breakage.`,
    );
  }

  await assembleServerBase(
    opts.fetchImpl,
    dirs.serverDir,
    { mcVersion: opts.mcVersion, loaderVersion: opts.loaderVersion },
    log,
  );

  const oracleJarPath = await findOracleJar(opts.oracleJar);
  const oracleJarRel = await injectOracleJar(dirs.serverDir, oracleJarPath);
  log(`Injected oracle mod: ${oracleJarRel}`);

  const { fingerprint, files } = await computeServerFingerprint(dirs.serverDir);
  log(`Pack fingerprint: ${fingerprint}`);

  let overlayDiff: OverlayDiffEntry[] = [];
  if (opts.overlay !== undefined) {
    log(`Applying overlay ${opts.overlay} ...`);
    overlayDiff = await applyOverlay(dirs.serverDir, opts.overlay);
    log(
      overlayDiff.length === 0
        ? "Overlay produced no drift (all files identical to pack defaults)."
        : `Overlay drift: ${overlayDiff.map((d) => `${d.kind} ${d.path}`).join(", ")}`,
    );
  }

  const manifest: RunManifest = {
    schema: 1,
    createdAt: new Date().toISOString(),
    pack: opts.pack,
    packName: opts.packName,
    packVersion: opts.packVersion,
    mcVersion: opts.mcVersion,
    loaderVersion: opts.loaderVersion,
    packFingerprint: fingerprint,
    files,
    overlayDiff,
    oracleJar: oracleJarRel,
    ...(opts.defaultSeed !== undefined ? { defaultSeed: opts.defaultSeed } : {}),
  };
  await writeRunManifest(dirs.runDir, manifest);

  log("");
  log(`Provisioned: ${dirs.runDir}`);
  log(`  pack        ${opts.packName} ${opts.packVersion} (MC ${opts.mcVersion}, Fabric loader ${opts.loaderVersion})`);
  log(`  fingerprint ${fingerprint}`);
  log("");
  log("Next:");
  log(`  seedmap run ${dirs.runDir} --seed <your /seed value> --accept-eula`);
  return manifest;
}

export { runDirs, ensureRunLayout };
