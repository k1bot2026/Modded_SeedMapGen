import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.js";
import { PINS } from "../pins.js";
import { parseMrpackIndex, type ParsedMrpack } from "../core/mrpack.js";
import { pickMrpackFile, selectVersion, type ModrinthVersion } from "../core/versionSelect.js";
import { downloadToFile, type FetchLike } from "../io/fetcher.js";
import { pathExists } from "../io/fsx.js";
import { ModrinthClient, parseModrinthRef } from "../io/modrinth.js";
import { extractZipSubtree, readZipEntry } from "../io/zip.js";
import { formatTable, mapPool, type Logger } from "../util.js";
import { ensureRunLayout, finalizeProvision, runDirs, sanitizeName } from "./shared.js";

export interface ProvisionModrinthOptions {
  version?: string;
  overlay?: string;
  out?: string;
  oracleJar?: string;
}

function printVersionList(log: Logger, title: string, ref: string, versions: ModrinthVersion[]): void {
  log(`Available versions for ${title}:`);
  log("");
  const rows: string[][] = [["VERSION", "ID", "MC", "LOADERS", "PUBLISHED"]];
  for (const v of versions) {
    rows.push([
      v.versionNumber,
      v.id,
      v.gameVersions.join(","),
      v.loaders.join(","),
      v.datePublished.slice(0, 10),
    ]);
  }
  log(formatTable(rows));
  log("");
  log("Version selection is explicit — this tool never resolves \"latest\" silently.");
  log("For a \"world state at creation\" map, pick the version the world was created with.");
  log("");
  log("Re-run with:");
  log(`  seedmap provision modrinth ${ref} --version <version number or id>`);
}

async function readMrpackIndex(mrpackPath: string): Promise<ParsedMrpack> {
  const raw = await readZipEntry(mrpackPath, "modrinth.index.json");
  if (raw === null) {
    throw new UserError(`${mrpackPath} contains no modrinth.index.json — not a valid .mrpack.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw new UserError(`modrinth.index.json is not valid JSON: ${(err as Error).message}`);
  }
  return parseMrpackIndex(json);
}

/**
 * `seedmap provision modrinth <slug|url|.mrpack>` — the PRIMARY flow.
 * Returns false when the command only listed versions (user must pick one).
 */
export async function provisionModrinth(
  ref: string,
  opts: ProvisionModrinthOptions,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<boolean> {
  const parsedRef = parseModrinthRef(ref, (p) => existsSync(p));

  let mrpackPath: string;
  let versionId: string | undefined;
  let dirs;

  if (parsedRef.kind === "file") {
    if (!(await pathExists(parsedRef.path))) {
      throw new UserError(`File not found: ${parsedRef.path}`);
    }
    mrpackPath = path.resolve(parsedRef.path);
    const peek = await readMrpackIndex(mrpackPath);
    dirs = runDirs(opts.out ?? path.join("runs", `${sanitizeName(peek.name)}-${sanitizeName(peek.versionId)}`));
    await ensureRunLayout(dirs);
  } else {
    const client = new ModrinthClient(fetchImpl);
    const project = await client.getProject(parsedRef.idOrSlug);
    const versions = await client.listVersions(project.id);
    const requested = opts.version ?? parsedRef.versionFromUrl;
    const choice = selectVersion(versions, requested);
    if (choice.kind === "list") {
      printVersionList(log, `${project.title} (${project.slug})`, project.slug, choice.versions);
      return false;
    }
    const version = choice.version;
    versionId = version.id;
    if (!version.loaders.includes("fabric")) {
      throw new UserError(
        `Version ${version.versionNumber} (${version.id}) is not a Fabric version ` +
          `(loaders: ${version.loaders.join(", ") || "none"}). Only Fabric packs are supported.`,
      );
    }
    dirs = runDirs(
      opts.out ?? path.join("runs", `${sanitizeName(project.slug)}-${sanitizeName(version.versionNumber)}`),
    );
    await ensureRunLayout(dirs);

    const file = pickMrpackFile(version);
    log(`Downloading ${file.filename} (${version.versionNumber}) ...`);
    // Kept after provisioning: re-running the same provision is then offline-cheap.
    mrpackPath = path.join(dirs.runDir, "pack.mrpack");
    const expected = file.sha512 !== undefined ? { sha512: file.sha512 } : {};
    await downloadToFile(fetchImpl, file.url, mrpackPath, expected);
  }

  const index = await readMrpackIndex(mrpackPath);
  log(`Pack: ${index.name} ${index.versionId} (MC ${index.mcVersion})`);
  for (const skip of index.skipped) {
    log(`  skipping ${skip.path} (${skip.reason})`);
  }

  log(`Downloading ${index.files.length} pack files ...`);
  let done = 0;
  await mapPool(index.files, 4, async (f) => {
    const dest = path.join(dirs.serverDir, ...f.path.split("/"));
    const expected: { sha512: string; sha1?: string } = { sha512: f.sha512 };
    if (f.sha1 !== undefined) expected.sha1 = f.sha1;
    let lastErr: Error | undefined;
    for (const url of f.downloads) {
      try {
        await downloadToFile(fetchImpl, url, dest, expected);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (lastErr !== undefined) throw lastErr;
    done += 1;
    log(`  [${done}/${index.files.length}] ${f.path}`);
  });

  log("Applying overrides/ ...");
  await extractZipSubtree(mrpackPath, dirs.serverDir, { prefix: "overrides/" });
  log("Applying server-overrides/ ...");
  await extractZipSubtree(mrpackPath, dirs.serverDir, { prefix: "server-overrides/" });
  // A pack must never pre-accept the EULA for the user.
  await rm(path.join(dirs.serverDir, "eula.txt"), { force: true });

  await finalizeProvision({
    fetchImpl,
    dirs,
    log,
    pack: {
      source: "modrinth",
      ref,
      ...(versionId !== undefined ? { versionId } : {}),
    },
    packName: index.name,
    packVersion: index.versionId,
    mcVersion: index.mcVersion,
    loaderVersion: index.fabricLoaderVersion ?? PINS.fabricLoader,
    ...(opts.oracleJar !== undefined ? { oracleJar: opts.oracleJar } : {}),
    ...(opts.overlay !== undefined ? { overlay: opts.overlay } : {}),
  });
  return true;
}
