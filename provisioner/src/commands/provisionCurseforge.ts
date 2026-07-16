import { copyFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { HashMismatchError, UserError } from "../errors.js";
import { PINS } from "../pins.js";
import { parseCfManifest, detectCurseforgeZipKind, type CfManifest } from "../core/cfManifest.js";
import { downloadToFile, type FetchLike } from "../io/fetcher.js";
import { ensureDir, pathExists } from "../io/fsx.js";
import { hashFile } from "../io/hash.js";
import { CurseforgeClient, requireCurseforgeApiKey, type CfFileInfo } from "../io/curseforge.js";
import { extractZipSubtree, listZipEntries, readZipEntry } from "../io/zip.js";
import { mapPool, sleep, type Logger } from "../util.js";
import { ensureRunLayout, finalizeProvision, runDirs, sanitizeName } from "./shared.js";

export interface ProvisionCurseforgeOptions {
  overlay?: string;
  out?: string;
  oracleJar?: string;
}

interface BlockedFile {
  info: CfFileInfo;
  modName: string;
  websiteUrl: string | undefined;
}

async function waitForManualDrops(
  blocked: BlockedFile[],
  manualDir: string,
  serverModsDir: string,
  log: Logger,
): Promise<void> {
  await ensureDir(manualDir);
  log("");
  log(`${blocked.length} mod(s) disallow third-party downloads. Download them manually`);
  log(`from CurseForge and drop the files into:`);
  log(`  ${manualDir}`);
  log("");
  for (const b of blocked) {
    const link = b.websiteUrl !== undefined ? `  <${b.websiteUrl}/files/${b.info.id}>` : "";
    log(`  - ${b.info.fileName}  (${b.modName})${link}`);
  }
  log("");

  const missing = new Map(blocked.map((b) => [b.info.fileName, b]));
  const check = async (): Promise<void> => {
    const present = new Set(await readdir(manualDir).catch(() => [] as string[]));
    for (const [fileName, b] of [...missing]) {
      if (!present.has(fileName)) continue;
      const src = path.join(manualDir, fileName);
      if (b.info.sha1 !== undefined) {
        const actual = await hashFile(src, "sha1");
        if (actual !== b.info.sha1) {
          throw new HashMismatchError(src, "sha1", b.info.sha1, actual);
        }
      }
      await copyFile(src, path.join(serverModsDir, fileName));
      missing.delete(fileName);
      log(`  found ${fileName} (${missing.size} remaining)`);
    }
  };

  await check();
  if (missing.size === 0) return;

  if (!process.stdin.isTTY) {
    throw new UserError(
      `Still waiting on ${missing.size} manual file(s) in ${manualDir} and stdin is not a ` +
        `terminal. Place the files there and re-run the same provision command.`,
    );
  }
  log(`Waiting for ${missing.size} file(s) ... (Ctrl+C to abort; re-running resumes)`);
  while (missing.size > 0) {
    await sleep(3000);
    await check();
  }
}

async function provisionFromManifest(
  zipPath: string,
  root: string,
  manifest: CfManifest,
  opts: ProvisionCurseforgeOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<void> {
  log(`Pack: ${manifest.name} ${manifest.version} (MC ${manifest.mcVersion}, Fabric loader ${manifest.fabricLoaderVersion})`);
  const dirs = runDirs(
    opts.out ?? path.join("runs", `${sanitizeName(manifest.name)}-${sanitizeName(manifest.version)}`),
  );
  await ensureRunLayout(dirs);
  const modsDir = path.join(dirs.serverDir, "mods");
  await ensureDir(modsDir);

  const apiKey = requireCurseforgeApiKey(process.env);
  const client = new CurseforgeClient(fetchImpl, apiKey);

  log(`Resolving ${manifest.files.length} files via the CurseForge Core API ...`);
  const fileInfos = await client.getFiles(manifest.files.map((f) => f.fileID));
  const byId = new Map(fileInfos.map((f) => [f.id, f]));
  const unresolved = manifest.files.filter((f) => !byId.has(f.fileID));
  if (unresolved.length > 0) {
    throw new UserError(
      `CurseForge did not return metadata for file id(s): ${unresolved.map((f) => f.fileID).join(", ")}.`,
    );
  }

  const downloadable = fileInfos.filter((f) => f.downloadUrl !== null);
  const blockedInfos = fileInfos.filter((f) => f.downloadUrl === null);

  let done = 0;
  await mapPool(downloadable, 4, async (f) => {
    const expected = f.sha1 !== undefined ? { sha1: f.sha1 } : {};
    await downloadToFile(fetchImpl, f.downloadUrl!, path.join(modsDir, f.fileName), expected);
    done += 1;
    log(`  [${done}/${downloadable.length}] ${f.fileName}`);
  });

  if (blockedInfos.length > 0) {
    const mods = await client.getMods([...new Set(blockedInfos.map((f) => f.modId))]);
    const modById = new Map(mods.map((m) => [m.id, m]));
    const blocked: BlockedFile[] = blockedInfos.map((info) => ({
      info,
      modName: modById.get(info.modId)?.name ?? `project ${info.modId}`,
      websiteUrl: modById.get(info.modId)?.websiteUrl,
    }));
    await waitForManualDrops(blocked, path.join(dirs.runDir, "mods-manual"), modsDir, log);
  }

  log(`Applying ${manifest.overridesDir}/ ...`);
  await extractZipSubtree(zipPath, dirs.serverDir, { prefix: `${root}${manifest.overridesDir}/` });
  await rm(path.join(dirs.serverDir, "eula.txt"), { force: true });

  await finalizeProvision({
    fetchImpl,
    dirs,
    log,
    pack: { source: "curseforge", ref: zipPath },
    packName: manifest.name,
    packVersion: manifest.version,
    mcVersion: manifest.mcVersion,
    loaderVersion: manifest.fabricLoaderVersion,
    ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
    ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
  });
}

async function provisionFromServerPack(
  zipPath: string,
  root: string,
  opts: ProvisionCurseforgeOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<void> {
  const baseName = sanitizeName(path.basename(zipPath).replace(/\.zip$/i, ""));
  log(`Detected an assembled server pack — extracting wholesale.`);
  const dirs = runDirs(opts.out ?? path.join("runs", baseName));
  await ensureRunLayout(dirs);

  await extractZipSubtree(zipPath, dirs.serverDir, { prefix: root });
  // Never inherit a pack-shipped EULA acceptance or stale world.
  await rm(path.join(dirs.serverDir, "eula.txt"), { force: true });

  await finalizeProvision({
    fetchImpl,
    dirs,
    log,
    pack: { source: "curseforge", ref: zipPath },
    packName: baseName,
    packVersion: "serverpack",
    mcVersion: PINS.minecraft,
    loaderVersion: PINS.fabricLoader,
    ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
    ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
  });
}

/** `seedmap provision curseforge <zip|serverpack.zip>` — secondary flow. */
export async function provisionCurseforge(
  zipRef: string,
  opts: ProvisionCurseforgeOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<void> {
  const zipPath = path.resolve(zipRef);
  if (!(await pathExists(zipPath))) {
    throw new UserError(`File not found: ${zipRef}`);
  }
  const entries = await listZipEntries(zipPath);
  const kind = detectCurseforgeZipKind(entries);

  if (kind.kind === "serverpack") {
    await provisionFromServerPack(zipPath, kind.root, opts, fetchImpl, log);
    return;
  }

  const raw = await readZipEntry(zipPath, `${kind.root}manifest.json`);
  if (raw === null) throw new UserError(`Could not read manifest.json from ${zipRef}.`);
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw new UserError(`manifest.json is not valid JSON: ${(err as Error).message}`);
  }
  const manifest = parseCfManifest(json);
  await provisionFromManifest(zipPath, kind.root, manifest, opts, fetchImpl, log);
}
