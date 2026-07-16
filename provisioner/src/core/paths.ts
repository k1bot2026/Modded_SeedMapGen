/**
 * Path normalization for archive entries and fingerprint lines.
 * All relative paths in this codebase use "/" separators on every platform.
 */
export function normalizeRelPath(p: string): string {
  let n = p.replace(/\\/g, "/");
  n = n.replace(/\/{2,}/g, "/");
  while (n.startsWith("./")) n = n.slice(2);
  return n;
}

/**
 * True when `p` is a safe relative path: non-empty, not absolute, no drive
 * letter, and no `.`/`..` segments (zip-slip guard).
 */
export function isSafeRelPath(p: string): boolean {
  const n = normalizeRelPath(p);
  if (n.length === 0 || n.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(n)) return false;
  const segments = n.endsWith("/") ? n.slice(0, -1).split("/") : n.split("/");
  return segments.every((s) => s !== "" && s !== "." && s !== "..");
}
