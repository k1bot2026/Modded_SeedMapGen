import { UserError } from "../errors.js";

/** The slice of a Modrinth project version this tool cares about. */
export interface ModrinthVersion {
  id: string;
  versionNumber: string;
  name: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  files: {
    url: string;
    filename: string;
    primary: boolean;
    sha512?: string;
    size?: number;
  }[];
}

export type VersionChoice =
  | { kind: "selected"; version: ModrinthVersion }
  | { kind: "list"; versions: ModrinthVersion[] };

/**
 * Explicit version pinning: with no requested version we NEVER resolve
 * "latest" — the caller must list the versions and let the user pick (for a
 * "world state at creation" map, the version the world was created with).
 *
 * `requested` matches a version id first (exact, case-sensitive — Modrinth ids
 * are base62), then a version number. Ambiguous or unknown values throw.
 */
export function selectVersion(
  versions: readonly ModrinthVersion[],
  requested: string | undefined,
): VersionChoice {
  const sorted = [...versions].sort((a, b) => b.datePublished.localeCompare(a.datePublished));
  if (requested === undefined || requested.trim() === "") {
    return { kind: "list", versions: sorted };
  }
  const wanted = requested.trim();

  const byId = sorted.find((v) => v.id === wanted);
  if (byId) return { kind: "selected", version: byId };

  const byNumber = sorted.filter((v) => v.versionNumber === wanted);
  if (byNumber.length === 1) return { kind: "selected", version: byNumber[0]! };
  if (byNumber.length > 1) {
    const ids = byNumber.map((v) => `  ${v.id}  (${v.name}, published ${v.datePublished})`).join("\n");
    throw new UserError(
      `Version number "${wanted}" is ambiguous — ${byNumber.length} versions match. ` +
        `Re-run with one of these version ids:\n${ids}`,
    );
  }

  const available = sorted
    .slice(0, 30)
    .map((v) => `  ${v.versionNumber}  (id ${v.id})`)
    .join("\n");
  throw new UserError(
    `No version with id or number "${wanted}". Available versions:\n${available}` +
      (sorted.length > 30 ? `\n  … and ${sorted.length - 30} more` : ""),
  );
}

/** Pick the .mrpack file of a version (primary first, then extension match). */
export function pickMrpackFile(version: ModrinthVersion): ModrinthVersion["files"][number] {
  const file =
    version.files.find((f) => f.primary) ??
    version.files.find((f) => f.filename.toLowerCase().endsWith(".mrpack")) ??
    version.files[0];
  if (!file) {
    throw new UserError(`Version ${version.versionNumber} (${version.id}) has no files.`);
  }
  return file;
}
