import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeFingerprint, isFingerprintPath } from "../src/core/fingerprint.js";

const A = { path: "mods/a.jar", sha512: "a".repeat(128) };
const B = { path: "config/b.toml", sha512: "b".repeat(128) };
const C = { path: "world/datapacks/c.zip", sha512: "c".repeat(128) };

describe("computeFingerprint", () => {
  it("matches the contract definition exactly", () => {
    // Hand-computed reference: sorted lines "sha512  path\n" hashed with sha256.
    const lines = [`${A.sha512}  mods/a.jar\n`, `${B.sha512}  config/b.toml\n`].sort();
    const expected = "sha256:" + createHash("sha256").update(lines.join(""), "utf8").digest("hex");
    expect(computeFingerprint([A, B])).toBe(expected);
  });

  it("is independent of input order (determinism)", () => {
    expect(computeFingerprint([A, B, C])).toBe(computeFingerprint([C, A, B]));
    expect(computeFingerprint([B, C, A])).toBe(computeFingerprint([A, B, C]));
  });

  it("normalizes Windows path separators", () => {
    const windows = { path: "mods\\a.jar", sha512: A.sha512 };
    expect(computeFingerprint([windows, B])).toBe(computeFingerprint([A, B]));
  });

  it("lowercases hash hex", () => {
    const upper = { path: "mods/a.jar", sha512: "A".repeat(128) };
    expect(computeFingerprint([upper])).toBe(computeFingerprint([A]));
  });

  it("changes when any file hash changes", () => {
    const mutated = { path: "mods/a.jar", sha512: "d".repeat(128) };
    expect(computeFingerprint([mutated, B])).not.toBe(computeFingerprint([A, B]));
  });

  it("prefixes sha256:", () => {
    expect(computeFingerprint([])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("isFingerprintPath", () => {
  it("covers mods/, config/, world/datapacks/ only", () => {
    expect(isFingerprintPath("mods/a.jar")).toBe(true);
    expect(isFingerprintPath("config/x/y.json")).toBe(true);
    expect(isFingerprintPath("world/datapacks/pack.zip")).toBe(true);
    expect(isFingerprintPath("world/level.dat")).toBe(false);
    expect(isFingerprintPath("server.properties")).toBe(false);
    expect(isFingerprintPath("modsx/evil.jar")).toBe(false);
    expect(isFingerprintPath("libraries/foo.jar")).toBe(false);
  });

  it("accepts Windows separators", () => {
    expect(isFingerprintPath("mods\\a.jar")).toBe(true);
    expect(isFingerprintPath("world\\datapacks\\p.zip")).toBe(true);
  });
});
