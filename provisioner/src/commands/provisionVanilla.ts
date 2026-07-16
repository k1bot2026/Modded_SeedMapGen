import path from "node:path";
import { UserError } from "../errors.js";
import { PINS } from "../pins.js";
import { pickMrpackFile, selectVersion } from "../core/versionSelect.js";
import { downloadToFile, type FetchLike } from "../io/fetcher.js";
import { ModrinthClient } from "../io/modrinth.js";
import type { Logger } from "../util.js";
import { ensureRunLayout, finalizeProvision, runDirs } from "./shared.js";

export interface ProvisionVanillaOptions {
  mc: string;
  out?: string;
  oracleJar?: string;
}

/**
 * `seedmap provision vanilla --mc 1.21.1` — no pack: vanilla + oracle only.
 * Fabric API is fetched too (pinned) since the oracle mod depends on it.
 */
export async function provisionVanilla(
  opts: ProvisionVanillaOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<void> {
  const mcVersion = opts.mc;
  const dirs = runDirs(opts.out ?? path.join("runs", `vanilla-${mcVersion}`));
  await ensureRunLayout(dirs);

  log(`Fetching Fabric API ${PINS.fabricApi} from Modrinth ...`);
  const modrinth = new ModrinthClient(fetchImpl);
  const versions = await modrinth.listVersions("fabric-api");
  const choice = selectVersion(versions, PINS.fabricApi);
  if (choice.kind !== "selected") {
    throw new UserError(`Fabric API ${PINS.fabricApi} not found on Modrinth.`);
  }
  const file = pickMrpackFile(choice.version);
  const expected = file.sha512 !== undefined ? { sha512: file.sha512 } : {};
  await downloadToFile(fetchImpl, file.url, path.join(dirs.serverDir, "mods", file.filename), expected);

  await finalizeProvision({
    fetchImpl,
    dirs,
    log,
    pack: { source: "vanilla", ref: `vanilla-${mcVersion}` },
    packName: "vanilla",
    packVersion: mcVersion,
    mcVersion,
    loaderVersion: PINS.fabricLoader,
    ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
  });
}
