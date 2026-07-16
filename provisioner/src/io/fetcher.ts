import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HashMismatchError, UserError } from "../errors.js";
import { USER_AGENT } from "../pins.js";

/**
 * Every HTTP call in this package goes through a FetchLike so tests can
 * inject fakes — no real network in tests, ever.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Native fetch with the Modrinth-policy User-Agent applied to every request. */
export function defaultFetch(): FetchLike {
  return (url, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT);
    return fetch(url, { ...init, headers, redirect: "follow" });
  };
}

export async function fetchJson(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new UserError(`HTTP ${res.status} ${res.statusText} for ${url}${body ? `\n  ${body}` : ""}`);
  }
  return await res.json();
}

export interface ExpectedHashes {
  sha1?: string;
  sha256?: string;
  sha512?: string;
}

export interface DownloadResult {
  sha512: string;
  bytes: number;
}

/**
 * Stream a URL to a file, hashing on the fly. Any expected hash that does not
 * match aborts the download, removes the partial file, and throws
 * HashMismatchError. Writes via a `.part` temp file and renames on success.
 */
export async function downloadToFile(
  fetchImpl: FetchLike,
  url: string,
  destPath: string,
  expected: ExpectedHashes = {},
): Promise<DownloadResult> {
  const res = await fetchImpl(url);
  if (!res.ok || res.body === null) {
    throw new UserError(`Download failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  await mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.part`;

  const algos = new Set<keyof ExpectedHashes>(["sha512"]);
  if (expected.sha1 !== undefined) algos.add("sha1");
  if (expected.sha256 !== undefined) algos.add("sha256");
  const hashers = new Map([...algos].map((a) => [a, createHash(a)]));
  let bytes = 0;

  try {
    const body = Readable.fromWeb(res.body);
    await pipeline(
      body,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          bytes += chunk.length;
          for (const h of hashers.values()) h.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(tmpPath),
    );

    const actual = new Map([...hashers].map(([a, h]) => [a, h.digest("hex")]));
    for (const algo of ["sha1", "sha256", "sha512"] as const) {
      const want = expected[algo];
      if (want !== undefined && want.toLowerCase() !== actual.get(algo)) {
        throw new HashMismatchError(url, algo, want.toLowerCase(), actual.get(algo) ?? "");
      }
    }

    await rm(destPath, { force: true });
    await rename(tmpPath, destPath);
    return { sha512: actual.get("sha512")!, bytes };
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
}
