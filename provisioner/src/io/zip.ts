import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { UserError } from "../errors.js";
import { isSafeRelPath, normalizeRelPath } from "../core/paths.js";

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) reject(err ?? new Error(`Failed to open zip ${zipPath}`));
      else resolve(zipfile);
    });
  });
}

function openEntryStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error("Failed to open zip entry stream"));
      else resolve(stream);
    });
  });
}

type EntryVisitor = (
  entry: yauzl.Entry,
  openStream: () => Promise<NodeJS.ReadableStream>,
) => Promise<"continue" | "stop">;

/** Sequentially visit zip entries (yauzl lazyEntries); visitor may stop early. */
async function forEachZipEntry(zipPath: string, visitor: EntryVisitor): Promise<void> {
  const zipfile = await openZip(zipPath);
  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on("error", reject);
      zipfile.on("end", resolve);
      zipfile.on("entry", (entry: yauzl.Entry) => {
        visitor(entry, () => openEntryStream(zipfile, entry)).then(
          (verdict) => {
            if (verdict === "stop") resolve();
            else zipfile.readEntry();
          },
          reject,
        );
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}

/** All entry names (directories keep their trailing "/"), normalized to "/" separators. */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const names: string[] = [];
  await forEachZipEntry(zipPath, (entry) => {
    names.push(normalizeRelPath(entry.fileName));
    return Promise.resolve("continue");
  });
  return names;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Read one entry to a Buffer, or null when the entry does not exist. */
export async function readZipEntry(zipPath: string, entryName: string): Promise<Buffer | null> {
  const wanted = normalizeRelPath(entryName);
  let result: Buffer | null = null;
  await forEachZipEntry(zipPath, async (entry, openStream) => {
    if (normalizeRelPath(entry.fileName) !== wanted) return "continue";
    result = await streamToBuffer(await openStream());
    return "stop";
  });
  return result;
}

export interface ExtractOptions {
  /**
   * Only entries under this prefix are extracted, with the prefix stripped
   * (e.g. "overrides/"). "" extracts everything.
   */
  prefix?: string;
}

/**
 * Extract a zip subtree into destDir. Entry names are validated against
 * zip-slip (no "..", no absolute paths, no drive letters) and the resolved
 * destination is verified to stay inside destDir. Returns the relative paths
 * (post prefix-strip, "/" separators) of extracted files.
 */
export async function extractZipSubtree(
  zipPath: string,
  destDir: string,
  options: ExtractOptions = {},
): Promise<string[]> {
  const prefix = options.prefix ?? "";
  const destRoot = path.resolve(destDir);
  const extracted: string[] = [];

  await forEachZipEntry(zipPath, async (entry, openStream) => {
    const name = normalizeRelPath(entry.fileName);
    if (prefix !== "" && !name.startsWith(prefix)) return "continue";
    const rel = name.slice(prefix.length);
    if (rel === "") return "continue";
    if (!isSafeRelPath(rel)) {
      throw new UserError(`Refusing unsafe zip entry path: ${JSON.stringify(entry.fileName)}`);
    }
    const target = path.resolve(destRoot, ...rel.replace(/\/$/, "").split("/"));
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      throw new UserError(`Zip entry escapes destination dir: ${JSON.stringify(entry.fileName)}`);
    }
    if (rel.endsWith("/")) {
      await mkdir(target, { recursive: true });
      return "continue";
    }
    await mkdir(path.dirname(target), { recursive: true });
    await pipeline(await openStream(), createWriteStream(target));
    extracted.push(rel);
    return "continue";
  });

  return extracted;
}
