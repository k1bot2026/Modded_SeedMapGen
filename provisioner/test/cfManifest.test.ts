import { describe, expect, it } from "vitest";
import { detectCurseforgeZipKind, parseCfManifest } from "../src/core/cfManifest.js";
import { UserError } from "../src/errors.js";

/** Minimal synthetic CurseForge manifest.json fixture. */
function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    minecraft: {
      version: "1.21.1",
      modLoaders: [{ id: "fabric-0.16.14", primary: true }],
    },
    manifestType: "minecraftModpack",
    manifestVersion: 1,
    name: "Test CF Pack",
    version: "2.0.1",
    author: "someone",
    files: [
      { projectID: 111, fileID: 1001, required: true },
      { projectID: 222, fileID: 2002, required: false },
    ],
    overrides: "overrides",
    ...overrides,
  };
}

describe("parseCfManifest", () => {
  it("parses the synthetic fixture", () => {
    const m = parseCfManifest(fixture());
    expect(m.name).toBe("Test CF Pack");
    expect(m.version).toBe("2.0.1");
    expect(m.mcVersion).toBe("1.21.1");
    expect(m.fabricLoaderVersion).toBe("0.16.14");
    expect(m.files).toEqual([
      { projectID: 111, fileID: 1001, required: true },
      { projectID: 222, fileID: 2002, required: false },
    ]);
    expect(m.overridesDir).toBe("overrides");
  });

  it("rejects non-modpack manifests", () => {
    expect(() => parseCfManifest(fixture({ manifestType: "something" }))).toThrow(UserError);
  });

  it("rejects Forge-only packs", () => {
    const forge = fixture({
      minecraft: { version: "1.21.1", modLoaders: [{ id: "forge-52.0.1", primary: true }] },
    });
    expect(() => parseCfManifest(forge)).toThrow(/Fabric/);
  });

  it("finds a non-primary fabric loader entry", () => {
    const mixed = fixture({
      minecraft: {
        version: "1.21.1",
        modLoaders: [
          { id: "forge-52.0.1", primary: true },
          { id: "fabric-0.16.14", primary: false },
        ],
      },
    });
    expect(parseCfManifest(mixed).fabricLoaderVersion).toBe("0.16.14");
  });

  it("defaults overrides dir and tolerates trailing slash", () => {
    const m = parseCfManifest(fixture({ overrides: undefined }));
    expect(m.overridesDir).toBe("overrides");
    expect(parseCfManifest(fixture({ overrides: "Overrides/" })).overridesDir).toBe("Overrides");
  });

  it("rejects malformed file entries", () => {
    expect(() => parseCfManifest(fixture({ files: [{ projectID: "x" }] }))).toThrow(UserError);
  });
});

describe("detectCurseforgeZipKind (server-pack heuristic)", () => {
  it("manifest.json at root -> manifest pack", () => {
    expect(detectCurseforgeZipKind(["manifest.json", "overrides/config/a.toml"])).toEqual({
      kind: "manifest",
      root: "",
    });
  });

  it("mods/ and no manifest.json -> server pack", () => {
    expect(
      detectCurseforgeZipKind(["mods/a.jar", "config/b.toml", "server.properties"]),
    ).toEqual({ kind: "serverpack", root: "" });
  });

  it("manifest.json wins when both exist", () => {
    expect(detectCurseforgeZipKind(["manifest.json", "mods/a.jar"]).kind).toBe("manifest");
  });

  it("tolerates a single wrapping top-level folder", () => {
    expect(detectCurseforgeZipKind(["Pack-1.0/manifest.json", "Pack-1.0/overrides/x"])).toEqual({
      kind: "manifest",
      root: "Pack-1.0/",
    });
    expect(detectCurseforgeZipKind(["srv/mods/a.jar", "srv/config/c.toml"])).toEqual({
      kind: "serverpack",
      root: "srv/",
    });
  });

  it("throws a helpful error on unrecognized zips", () => {
    expect(() => detectCurseforgeZipKind(["readme.txt", "images/logo.png"])).toThrow(
      /no manifest\.json and no mods\//,
    );
  });
});
