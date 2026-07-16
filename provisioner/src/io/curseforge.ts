import { UserError } from "../errors.js";
import { CURSEFORGE_API } from "../pins.js";
import { fetchJson, type FetchLike } from "./fetcher.js";

export interface CfFileInfo {
  id: number;
  modId: number;
  fileName: string;
  /** null when the author disallows third-party (API) distribution. */
  downloadUrl: string | null;
  sha1?: string;
  fileLength?: number;
}

export interface CfModInfo {
  id: number;
  name: string;
  slug: string;
  /** Website URL of the mod, for manual-download instructions. */
  websiteUrl?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CF_ALGO_SHA1 = 1;

export class CurseforgeClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly apiKey: string,
    private readonly baseUrl: string = CURSEFORGE_API,
  ) {}

  private headers(): Record<string, string> {
    return { "x-api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" };
  }

  /** POST /v1/mods/files — batch file metadata lookup. */
  async getFiles(fileIds: number[]): Promise<CfFileInfo[]> {
    const json = await fetchJson(this.fetchImpl, `${this.baseUrl}/v1/mods/files`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ fileIds }),
    });
    if (!isRecord(json) || !Array.isArray(json.data)) {
      throw new UserError("Unexpected CurseForge /v1/mods/files response.");
    }
    return json.data.filter(isRecord).map((raw) => {
      if (typeof raw.id !== "number" || typeof raw.modId !== "number" || typeof raw.fileName !== "string") {
        throw new UserError("Unexpected CurseForge file entry (missing id/modId/fileName).");
      }
      const info: CfFileInfo = {
        id: raw.id,
        modId: raw.modId,
        fileName: raw.fileName,
        downloadUrl: typeof raw.downloadUrl === "string" && raw.downloadUrl !== "" ? raw.downloadUrl : null,
      };
      if (Array.isArray(raw.hashes)) {
        const sha1 = raw.hashes
          .filter(isRecord)
          .find((h) => h.algo === CF_ALGO_SHA1 && typeof h.value === "string");
        if (sha1) info.sha1 = (sha1.value as string).toLowerCase();
      }
      if (typeof raw.fileLength === "number") info.fileLength = raw.fileLength;
      return info;
    });
  }

  /** POST /v1/mods — batch mod metadata lookup (names/links for manual downloads). */
  async getMods(modIds: number[]): Promise<CfModInfo[]> {
    if (modIds.length === 0) return [];
    const json = await fetchJson(this.fetchImpl, `${this.baseUrl}/v1/mods`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ modIds }),
    });
    if (!isRecord(json) || !Array.isArray(json.data)) {
      throw new UserError("Unexpected CurseForge /v1/mods response.");
    }
    return json.data.filter(isRecord).map((raw) => {
      const info: CfModInfo = {
        id: typeof raw.id === "number" ? raw.id : -1,
        name: typeof raw.name === "string" ? raw.name : "unknown",
        slug: typeof raw.slug === "string" ? raw.slug : "",
      };
      const links = isRecord(raw.links) ? raw.links : {};
      if (typeof links.websiteUrl === "string") info.websiteUrl = links.websiteUrl;
      return info;
    });
  }
}

export function requireCurseforgeApiKey(env: NodeJS.ProcessEnv): string {
  const key = env.CURSEFORGE_API_KEY;
  if (key === undefined || key.trim() === "") {
    throw new UserError(
      "CURSEFORGE_API_KEY is not set. Get a (free) CurseForge Core API key at\n" +
        "https://console.curseforge.com/ and export it:\n" +
        "  export CURSEFORGE_API_KEY=...   (or `set` on Windows)",
    );
  }
  return key.trim();
}
