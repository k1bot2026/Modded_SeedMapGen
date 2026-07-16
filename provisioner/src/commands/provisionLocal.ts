import path from "node:path";
import { UserError } from "../errors.js";
import { PINS } from "../pins.js";
import { parseSeed } from "../core/seed.js";
import { parseServerProperties } from "../core/serverProperties.js";
import type { FetchLike } from "../io/fetcher.js";
import { copyTree, pathExists, readTextIfExists } from "../io/fsx.js";
import type { Logger } from "../util.js";
import { ensureRunLayout, finalizeProvision, runDirs, sanitizeName } from "./shared.js";

export interface ProvisionLocalOptions {
  overlay?: string;
  out?: string;
  oracleJar?: string;
}

/**
 * `seedmap provision local <serverDir>` — advanced flow when filesystem
 * access to an existing server exists. Copies mods/, config/ and
 * world/datapacks/ only (never player or chunk data, never symlinks), and
 * reads level-seed from server.properties as the default seed.
 */
export async function provisionLocal(
  serverDirRef: string,
  opts: ProvisionLocalOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<void> {
  const srcDir = path.resolve(serverDirRef);
  if (!(await pathExists(srcDir))) {
    throw new UserError(`Server directory not found: ${serverDirRef}`);
  }

  const packName = sanitizeName(path.basename(srcDir));
  const dirs = runDirs(opts.out ?? path.join("runs", `local-${packName}`));
  await ensureRunLayout(dirs);

  let copiedAnything = false;
  for (const sub of ["mods", "config", "world/datapacks"]) {
    const src = path.join(srcDir, ...sub.split("/"));
    if (!(await pathExists(src))) {
      log(`  (no ${sub}/ in source, skipping)`);
      continue;
    }
    const copied = await copyTree(src, path.join(dirs.serverDir, ...sub.split("/")));
    log(`  copied ${copied.length} file(s) from ${sub}/`);
    copiedAnything = true;
  }
  if (!copiedAnything) {
    throw new UserError(
      `${srcDir} contains none of mods/, config/, world/datapacks/ — is this really a server directory?`,
    );
  }

  // Player/world data is deliberately never copied: only the three dirs above
  // are read, and the oracle generates its own throwaway world-oracle/.

  let defaultSeed: string | undefined;
  const props = await readTextIfExists(path.join(srcDir, "server.properties"));
  if (props !== null) {
    const levelSeed = parseServerProperties(props).get("level-seed");
    if (levelSeed !== undefined && levelSeed !== "") {
      try {
        defaultSeed = parseSeed(levelSeed);
        log(`  default seed from server.properties: ${defaultSeed}`);
      } catch {
        log(`  level-seed ${JSON.stringify(levelSeed)} is not a numeric seed; ignoring.`);
      }
    }
  }

  await finalizeProvision({
    fetchImpl,
    dirs,
    log,
    pack: { source: "local", ref: srcDir },
    packName,
    packVersion: "local",
    mcVersion: PINS.minecraft,
    loaderVersion: PINS.fabricLoader,
    ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
    ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
    ...(defaultSeed !== undefined ? { defaultSeed } : {}),
  });
}
