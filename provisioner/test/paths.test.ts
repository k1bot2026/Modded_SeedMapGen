import { describe, expect, it } from "vitest";
import { isSafeRelPath, normalizeRelPath } from "../src/core/paths.js";
import { parseModrinthRef } from "../src/io/modrinth.js";

describe("normalizeRelPath", () => {
  it("converts Windows separators and collapses noise", () => {
    expect(normalizeRelPath("mods\\sub\\a.jar")).toBe("mods/sub/a.jar");
    expect(normalizeRelPath("./mods//a.jar")).toBe("mods/a.jar");
  });
});

describe("isSafeRelPath", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeRelPath("mods/a.jar")).toBe(true);
    expect(isSafeRelPath("config/dir/")).toBe(true);
    expect(isSafeRelPath("world/datapacks/p.zip")).toBe(true);
  });

  it("rejects traversal, absolute, drive letters, and empties", () => {
    expect(isSafeRelPath("../x")).toBe(false);
    expect(isSafeRelPath("a/../../x")).toBe(false);
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("C:/Windows/evil")).toBe(false);
    expect(isSafeRelPath("c:\\evil")).toBe(false);
    expect(isSafeRelPath("")).toBe(false);
    expect(isSafeRelPath("a/./b")).toBe(false);
  });
});

describe("parseModrinthRef", () => {
  const noFile = (): boolean => false;

  it("classifies .mrpack files and existing paths as files", () => {
    expect(parseModrinthRef("Cobbleverse-1.7.2.MRPACK", noFile)).toEqual({
      kind: "file",
      path: "Cobbleverse-1.7.2.MRPACK",
    });
    expect(parseModrinthRef("some/local/thing", () => true)).toEqual({
      kind: "file",
      path: "some/local/thing",
    });
  });

  it("extracts slug (and version) from modrinth.com URLs", () => {
    expect(parseModrinthRef("https://modrinth.com/modpack/cobbleverse", noFile)).toEqual({
      kind: "project",
      idOrSlug: "cobbleverse",
    });
    expect(
      parseModrinthRef("https://modrinth.com/modpack/cobbleverse/version/1.7.2", noFile),
    ).toEqual({ kind: "project", idOrSlug: "cobbleverse", versionFromUrl: "1.7.2" });
  });

  it("treats plain slugs as projects and rejects foreign URLs", () => {
    expect(parseModrinthRef("cobbleverse", noFile)).toEqual({
      kind: "project",
      idOrSlug: "cobbleverse",
    });
    expect(() => parseModrinthRef("https://example.com/pack", noFile)).toThrow(/modrinth\.com/);
  });
});
