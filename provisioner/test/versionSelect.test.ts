import { describe, expect, it } from "vitest";
import { pickMrpackFile, selectVersion, type ModrinthVersion } from "../src/core/versionSelect.js";
import { UserError } from "../src/errors.js";

function v(id: string, versionNumber: string, datePublished: string): ModrinthVersion {
  return {
    id,
    versionNumber,
    name: `Release ${versionNumber}`,
    gameVersions: ["1.21.1"],
    loaders: ["fabric"],
    datePublished,
    files: [{ url: `https://cdn.example/${id}.mrpack`, filename: `${id}.mrpack`, primary: true }],
  };
}

const VERSIONS = [
  v("AAAA1111", "1.7.0", "2025-01-01T00:00:00Z"),
  v("BBBB2222", "1.7.1", "2025-03-01T00:00:00Z"),
  v("CCCC3333", "1.7.2", "2025-06-01T00:00:00Z"),
];

describe("selectVersion", () => {
  it("REFUSES to resolve latest: no requested version -> list, never a pick", () => {
    const choice = selectVersion(VERSIONS, undefined);
    expect(choice.kind).toBe("list");
    // And the list is newest-first for display.
    if (choice.kind === "list") {
      expect(choice.versions.map((x) => x.versionNumber)).toEqual(["1.7.2", "1.7.1", "1.7.0"]);
    }
  });

  it("treats an empty/whitespace version as not-provided", () => {
    expect(selectVersion(VERSIONS, "  ").kind).toBe("list");
  });

  it("selects by exact version id", () => {
    const choice = selectVersion(VERSIONS, "BBBB2222");
    expect(choice.kind).toBe("selected");
    if (choice.kind === "selected") expect(choice.version.versionNumber).toBe("1.7.1");
  });

  it("selects by version number", () => {
    const choice = selectVersion(VERSIONS, "1.7.2");
    expect(choice.kind).toBe("selected");
    if (choice.kind === "selected") expect(choice.version.id).toBe("CCCC3333");
  });

  it("throws on unknown versions, listing what exists", () => {
    expect(() => selectVersion(VERSIONS, "9.9.9")).toThrow(UserError);
    expect(() => selectVersion(VERSIONS, "9.9.9")).toThrow(/1\.7\.2/);
  });

  it("throws on ambiguous version numbers, listing ids", () => {
    const dup = [...VERSIONS, v("DDDD4444", "1.7.2", "2025-06-02T00:00:00Z")];
    expect(() => selectVersion(dup, "1.7.2")).toThrow(/ambiguous/i);
    expect(() => selectVersion(dup, "1.7.2")).toThrow(/DDDD4444/);
  });

  it("id match wins over version-number match", () => {
    const tricky = [...VERSIONS, v("1.7.2", "1.8.0", "2025-07-01T00:00:00Z")];
    const choice = selectVersion(tricky, "1.7.2");
    expect(choice.kind).toBe("selected");
    if (choice.kind === "selected") expect(choice.version.versionNumber).toBe("1.8.0");
  });
});

describe("pickMrpackFile", () => {
  it("prefers the primary file", () => {
    const version: ModrinthVersion = {
      ...v("X", "1.0.0", "2025-01-01T00:00:00Z"),
      files: [
        { url: "https://cdn.example/alt.zip", filename: "alt.zip", primary: false },
        { url: "https://cdn.example/pack.mrpack", filename: "pack.mrpack", primary: true },
      ],
    };
    expect(pickMrpackFile(version).filename).toBe("pack.mrpack");
  });

  it("falls back to .mrpack extension, then first file", () => {
    const version: ModrinthVersion = {
      ...v("X", "1.0.0", "2025-01-01T00:00:00Z"),
      files: [
        { url: "https://cdn.example/readme.txt", filename: "readme.txt", primary: false },
        { url: "https://cdn.example/p.MRPACK", filename: "p.MRPACK", primary: false },
      ],
    };
    expect(pickMrpackFile(version).filename).toBe("p.MRPACK");
  });

  it("throws when a version has no files", () => {
    const version = { ...v("X", "1.0.0", "2025-01-01T00:00:00Z"), files: [] };
    expect(() => pickMrpackFile(version)).toThrow(UserError);
  });
});
