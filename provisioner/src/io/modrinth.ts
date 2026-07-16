import { UserError } from "../errors.js";
import { MODRINTH_API } from "../pins.js";
import type { ModrinthVersion } from "../core/versionSelect.js";
import { fetchJson, type FetchLike } from "./fetcher.js";

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
}

export type ModrinthRef =
  | { kind: "file"; path: string }
  | { kind: "project"; idOrSlug: string; versionFromUrl?: string };

/**
 * Interpret the `provision modrinth <slug|url|.mrpack>` argument.
 * `isLocalFile` lets the caller decide whether an arbitrary string is an
 * existing file on disk.
 */
export function parseModrinthRef(arg: string, isLocalFile: (p: string) => boolean): ModrinthRef {
  if (arg.toLowerCase().endsWith(".mrpack") || isLocalFile(arg)) {
    return { kind: "file", path: arg };
  }
  if (/^https?:\/\//i.test(arg)) {
    let url: URL;
    try {
      url = new URL(arg);
    } catch {
      throw new UserError(`Not a valid URL: ${arg}`);
    }
    if (!/(^|\.)modrinth\.com$/i.test(url.hostname)) {
      throw new UserError(
        `Unsupported URL host ${url.hostname}: expected a modrinth.com project URL, a project slug, or a .mrpack file.`,
      );
    }
    // e.g. /modpack/cobbleverse or /modpack/cobbleverse/version/1.7.2
    const segments = url.pathname.split("/").filter((s) => s !== "");
    if (segments.length < 2) {
      throw new UserError(`Cannot extract a project slug from ${arg}`);
    }
    const idOrSlug = segments[1]!;
    const ref: ModrinthRef = { kind: "project", idOrSlug };
    if (segments[2] === "version" && segments[3] !== undefined) {
      ref.versionFromUrl = decodeURIComponent(segments[3]);
    }
    return ref;
  }
  if (!/^[\w!@$()`.+,"'-]+$/.test(arg)) {
    throw new UserError(`Not a valid Modrinth slug, URL, or .mrpack path: ${JSON.stringify(arg)}`);
  }
  return { kind: "project", idOrSlug: arg };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export class ModrinthClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly baseUrl: string = MODRINTH_API,
  ) {}

  async getProject(idOrSlug: string): Promise<ModrinthProject> {
    const json = await fetchJson(this.fetchImpl, `${this.baseUrl}/project/${encodeURIComponent(idOrSlug)}`);
    if (!isRecord(json) || typeof json.id !== "string" || typeof json.slug !== "string") {
      throw new UserError(`Unexpected Modrinth project response for "${idOrSlug}".`);
    }
    return { id: json.id, slug: json.slug, title: typeof json.title === "string" ? json.title : json.slug };
  }

  async listVersions(idOrSlug: string): Promise<ModrinthVersion[]> {
    const json = await fetchJson(
      this.fetchImpl,
      `${this.baseUrl}/project/${encodeURIComponent(idOrSlug)}/version`,
    );
    if (!Array.isArray(json)) {
      throw new UserError(`Unexpected Modrinth version list response for "${idOrSlug}".`);
    }
    return json.map((raw, i) => {
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.version_number !== "string") {
        throw new UserError(`Unexpected Modrinth version entry at index ${i} for "${idOrSlug}".`);
      }
      const files = Array.isArray(raw.files) ? raw.files : [];
      const version: ModrinthVersion = {
        id: raw.id,
        versionNumber: raw.version_number,
        name: typeof raw.name === "string" ? raw.name : raw.version_number,
        gameVersions: Array.isArray(raw.game_versions)
          ? raw.game_versions.filter((v): v is string => typeof v === "string")
          : [],
        loaders: Array.isArray(raw.loaders)
          ? raw.loaders.filter((v): v is string => typeof v === "string")
          : [],
        datePublished: typeof raw.date_published === "string" ? raw.date_published : "",
        files: files.filter(isRecord).map((f) => {
          const hashes = isRecord(f.hashes) ? f.hashes : {};
          const entry: ModrinthVersion["files"][number] = {
            url: typeof f.url === "string" ? f.url : "",
            filename: typeof f.filename === "string" ? f.filename : "",
            primary: f.primary === true,
          };
          if (typeof hashes.sha512 === "string") entry.sha512 = hashes.sha512;
          if (typeof f.size === "number") entry.size = f.size;
          return entry;
        }),
      };
      return version;
    });
  }
}
