import { describe, expect, it } from "vitest";
import { parseMrpackIndex } from "../src/core/mrpack.js";
import { UserError } from "../src/errors.js";

/** Minimal synthetic modrinth.index.json fixture. */
function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    game: "minecraft",
    versionId: "1.7.2",
    name: "Testpack",
    summary: "synthetic fixture",
    files: [
      {
        path: "mods/server-and-client.jar",
        hashes: { sha1: "1".repeat(40), sha512: "a".repeat(128) },
        env: { client: "required", server: "required" },
        downloads: ["https://cdn.example/a.jar"],
        fileSize: 10,
      },
      {
        path: "mods/client-only.jar",
        hashes: { sha512: "b".repeat(128) },
        env: { client: "required", server: "unsupported" },
        downloads: ["https://cdn.example/b.jar"],
      },
      {
        path: "mods/optional-on-server.jar",
        hashes: { sha512: "c".repeat(128) },
        env: { client: "optional", server: "optional" },
        downloads: ["https://cdn.example/c.jar"],
      },
      {
        path: "mods/no-env.jar",
        hashes: { sha512: "d".repeat(128) },
        downloads: ["https://cdn.example/d.jar"],
      },
    ],
    dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
    ...overrides,
  };
}

describe("parseMrpackIndex", () => {
  it("parses the synthetic fixture", () => {
    const parsed = parseMrpackIndex(fixture());
    expect(parsed.name).toBe("Testpack");
    expect(parsed.versionId).toBe("1.7.2");
    expect(parsed.mcVersion).toBe("1.21.1");
    expect(parsed.fabricLoaderVersion).toBe("0.16.14");
    expect(parsed.files.map((f) => f.path)).toEqual([
      "mods/server-and-client.jar",
      "mods/optional-on-server.jar",
      "mods/no-env.jar",
    ]);
  });

  it('skips entries with env.server == "unsupported" and reports them', () => {
    const parsed = parseMrpackIndex(fixture());
    expect(parsed.skipped).toEqual([
      { path: "mods/client-only.jar", reason: 'env.server == "unsupported"' },
    ]);
  });

  it("treats a missing env as server-required (included)", () => {
    const parsed = parseMrpackIndex(fixture());
    expect(parsed.files.find((f) => f.path === "mods/no-env.jar")?.envServer).toBe("required");
  });

  it("rejects path traversal and absolute paths (zip-slip)", () => {
    for (const evil of ["../evil.jar", "mods/../../evil.jar", "/etc/passwd", "C:\\windows\\evil.jar"]) {
      const bad = fixture({
        files: [
          {
            path: evil,
            hashes: { sha512: "e".repeat(128) },
            downloads: ["https://cdn.example/e.jar"],
          },
        ],
      });
      expect(() => parseMrpackIndex(bad), evil).toThrow(/unsafe file path/i);
    }
  });

  it("requires a sha512 hash per file", () => {
    const bad = fixture({
      files: [{ path: "mods/x.jar", hashes: { sha1: "1".repeat(40) }, downloads: ["https://x/y"] }],
    });
    expect(() => parseMrpackIndex(bad)).toThrow(/sha512/);
  });

  it("rejects non-Fabric loaders", () => {
    expect(() =>
      parseMrpackIndex(fixture({ dependencies: { minecraft: "1.21.1", forge: "51.0.0" } })),
    ).toThrow(/Fabric/);
    expect(() =>
      parseMrpackIndex(fixture({ dependencies: { minecraft: "1.21.1", "quilt-loader": "0.26.0" } })),
    ).toThrow(/Fabric/);
  });

  it("rejects wrong formatVersion and game", () => {
    expect(() => parseMrpackIndex(fixture({ formatVersion: 2 }))).toThrow(UserError);
    expect(() => parseMrpackIndex(fixture({ game: "hytale" }))).toThrow(UserError);
  });

  it("requires a minecraft dependency", () => {
    expect(() => parseMrpackIndex(fixture({ dependencies: {} }))).toThrow(/minecraft/);
  });
});
