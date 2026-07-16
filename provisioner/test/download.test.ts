import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HashMismatchError, UserError } from "../src/errors.js";
import { defaultFetch, downloadToFile, type FetchLike } from "../src/io/fetcher.js";
import { USER_AGENT } from "../src/pins.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedmap-dl-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const PAYLOAD = Buffer.from("mod jar bytes go here");
const sha = (algo: string): string => createHash(algo).update(PAYLOAD).digest("hex");

/** Fake fetch that never touches the network. */
const fakeFetch =
  (status = 200, body: Buffer | null = PAYLOAD): FetchLike =>
  (_url, _init) =>
    Promise.resolve(
      new Response(body, { status, statusText: status === 200 ? "OK" : "Not Found" }),
    );

describe("downloadToFile", () => {
  it("writes the file and reports its sha512 on success", async () => {
    const dest = path.join(tmpDir, "sub", "dir", "a.jar");
    const result = await downloadToFile(fakeFetch(), "https://cdn.example/a.jar", dest, {
      sha512: sha("sha512"),
      sha1: sha("sha1"),
    });
    expect(await readFile(dest)).toEqual(PAYLOAD);
    expect(result.sha512).toBe(sha("sha512"));
    expect(result.bytes).toBe(PAYLOAD.length);
  });

  it("accepts uppercase expected hashes", async () => {
    const dest = path.join(tmpDir, "b.jar");
    await downloadToFile(fakeFetch(), "https://cdn.example/b.jar", dest, {
      sha512: sha("sha512").toUpperCase(),
    });
    expect(await readFile(dest)).toEqual(PAYLOAD);
  });

  it("HASH VERIFY FAILURE: throws and leaves no file behind", async () => {
    const dest = path.join(tmpDir, "evil.jar");
    await expect(
      downloadToFile(fakeFetch(), "https://cdn.example/evil.jar", dest, {
        sha512: "f".repeat(128),
      }),
    ).rejects.toThrow(HashMismatchError);
    // Neither the target nor a .part temp file may survive.
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("verifies sha1 too (Mojang server jar path)", async () => {
    const dest = path.join(tmpDir, "server.jar");
    await expect(
      downloadToFile(fakeFetch(), "https://cdn.example/server.jar", dest, {
        sha1: "0".repeat(40),
      }),
    ).rejects.toThrow(/sha1 mismatch/);
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("throws a UserError on HTTP errors", async () => {
    await expect(
      downloadToFile(fakeFetch(404, null), "https://cdn.example/missing.jar", path.join(tmpDir, "x")),
    ).rejects.toThrow(UserError);
  });
});

describe("defaultFetch", () => {
  it("sends the Modrinth-policy User-Agent on every request", async () => {
    const spy = vi.fn((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toBe(USER_AGENT);
      expect(USER_AGENT).toBe("modpack-seedmap/0.1.0 (github.com/k1bot2026/Modded_SeedMapGen)");
      return Promise.resolve(new Response("{}"));
    });
    vi.stubGlobal("fetch", spy);
    try {
      await defaultFetch()("https://api.modrinth.com/v2/project/x");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
