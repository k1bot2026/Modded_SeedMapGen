import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

export async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Recursively list files under `root`, returning paths relative to `root`
 * with "/" separators, sorted. Symlinks are followed via stat (dereferenced);
 * dangling links are skipped.
 */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relChild = rel === "" ? entry.name : `${rel}/${entry.name}`;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const s = await stat(abs);
          isDir = s.isDirectory();
          isFile = s.isFile();
        } catch {
          continue; // dangling symlink
        }
      }
      if (isDir) await recurse(abs, relChild);
      else if (isFile) out.push(relChild);
    }
  }
  await recurse(root, "");
  out.sort();
  return out;
}

/**
 * Copy a tree, dereferencing symlinks (a copy NEVER creates symlinks — spec
 * rule for `provision local`). Returns the relative paths copied.
 */
export async function copyTree(srcDir: string, destDir: string): Promise<string[]> {
  const files = await walkFiles(srcDir);
  for (const rel of files) {
    const dest = path.join(destDir, ...rel.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(srcDir, ...rel.split("/")), dest);
  }
  return files;
}
