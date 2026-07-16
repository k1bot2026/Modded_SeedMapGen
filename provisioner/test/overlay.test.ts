import { describe, expect, it } from "vitest";
import { computeOverlayDiff } from "../src/core/overlay.js";

const H1 = "1".repeat(128);
const H2 = "2".repeat(128);
const H3 = "3".repeat(128);

describe("computeOverlayDiff", () => {
  it("classifies added vs replaced and drops identical files", () => {
    const pre = new Map([
      ["config/terralith.toml", H1],
      ["server.properties", H2],
    ]);
    const overlay = [
      { path: "config/terralith.toml", sha512: H3 }, // existed, different -> replaced
      { path: "server.properties", sha512: H2 }, // existed, identical -> no drift
      { path: "config/new-tweak.json", sha512: H1 }, // new -> added
    ];
    expect(computeOverlayDiff(pre, overlay)).toEqual([
      { path: "config/new-tweak.json", kind: "added" },
      { path: "config/terralith.toml", kind: "replaced" },
    ]);
  });

  it("is sorted by path for determinism", () => {
    const overlay = [
      { path: "z.txt", sha512: H1 },
      { path: "a.txt", sha512: H1 },
      { path: "m/n.txt", sha512: H1 },
    ];
    expect(computeOverlayDiff(new Map(), overlay).map((d) => d.path)).toEqual([
      "a.txt",
      "m/n.txt",
      "z.txt",
    ]);
  });

  it("compares hashes case-insensitively", () => {
    const pre = new Map([["f", "ABC".padEnd(128, "0").toLowerCase()]]);
    const overlay = [{ path: "f", sha512: "abc".padEnd(128, "0").toUpperCase() }];
    expect(computeOverlayDiff(pre, overlay)).toEqual([]);
  });

  it("returns empty for an empty overlay", () => {
    expect(computeOverlayDiff(new Map([["x", H1]]), [])).toEqual([]);
  });
});
