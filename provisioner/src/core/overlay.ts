export type OverlayKind = "added" | "replaced";

export interface OverlayDiffEntry {
  path: string;
  kind: OverlayKind;
}

export interface OverlayFileHash {
  /** Path relative to the server dir ("/" separators). */
  path: string;
  sha512: string;
}

/**
 * Diff overlay files against the pre-overlay server state.
 * - path absent before the overlay        -> "added"
 * - path present with different contents  -> "replaced"
 * - path present with identical contents  -> no drift, omitted
 * Result is sorted by path for determinism.
 */
export function computeOverlayDiff(
  preOverlay: ReadonlyMap<string, string>,
  overlayFiles: readonly OverlayFileHash[],
): OverlayDiffEntry[] {
  const diff: OverlayDiffEntry[] = [];
  for (const f of overlayFiles) {
    const before = preOverlay.get(f.path);
    if (before === undefined) diff.push({ path: f.path, kind: "added" });
    else if (before.toLowerCase() !== f.sha512.toLowerCase()) {
      diff.push({ path: f.path, kind: "replaced" });
    }
  }
  diff.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return diff;
}
