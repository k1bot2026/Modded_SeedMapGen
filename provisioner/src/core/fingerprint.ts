import { createHash } from "node:crypto";
import { normalizeRelPath } from "./paths.js";

/**
 * Directories (relative to the assembled server dir) that participate in the
 * pack fingerprint, per docs/oracle-api.md.
 */
export const FINGERPRINT_ROOTS = ["mods", "config", "world/datapacks"] as const;

export function isFingerprintPath(relPath: string): boolean {
  const n = normalizeRelPath(relPath);
  return FINGERPRINT_ROOTS.some((root) => n === root || n.startsWith(`${root}/`));
}

export interface FingerprintFile {
  /** Path relative to the server dir; any separator style accepted. */
  path: string;
  /** Lowercase hex sha512 of the file contents. */
  sha512: string;
}

/**
 * packFingerprint per docs/oracle-api.md:
 * "sha256:" + sha256 of the sorted per-file lines, where each line is
 * `sha512(file) + "  " + normalized-relative-path + "\n"`.
 * Lines are sorted lexicographically as strings; paths use "/" on all platforms.
 */
export function computeFingerprint(files: readonly FingerprintFile[]): string {
  const lines = files.map((f) => `${f.sha512.toLowerCase()}  ${normalizeRelPath(f.path)}\n`);
  lines.sort();
  const digest = createHash("sha256").update(lines.join(""), "utf8").digest("hex");
  return `sha256:${digest}`;
}
