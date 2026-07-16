import { describe, expect, it } from "vitest";
import { canonicalJson, firstByteDivergence, firstJsonDifference, isPng, sha256Hex } from "../src/core/compare.js";
import { pngBytes } from "./helpers.js";

describe("firstByteDivergence", () => {
  it("returns null for identical arrays", () => {
    expect(firstByteDivergence(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("finds the first differing index", () => {
    expect(firstByteDivergence(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toEqual({
      index: 1,
      a: 2,
      b: 9,
    });
  });

  it("reports a length mismatch at the shared end", () => {
    expect(firstByteDivergence(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toEqual({
      index: 2,
      a: null,
      b: 3,
    });
  });
});

describe("canonicalJson", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: "x" } })).toBe('{"a":{"c":"x","d":[2,1]},"b":1}');
  });

  it("is insensitive to key insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe("firstJsonDifference", () => {
  it("returns null for deep-equal values", () => {
    expect(firstJsonDifference({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBeNull();
  });

  it("names the differing path", () => {
    expect(firstJsonDifference({ mods: [{ version: "1.0" }] }, { mods: [{ version: "1.1" }] })).toBe(
      '$.mods[0].version: "1.0" vs "1.1"',
    );
  });

  it("reports missing keys and array length differences", () => {
    expect(firstJsonDifference({ a: 1 }, {})).toBe("$.a: missing in B");
    expect(firstJsonDifference([1], [1, 2])).toBe("$: array length 1 vs 2");
  });

  it("reports type mismatches", () => {
    expect(firstJsonDifference({ seed: "1" }, { seed: 1 })).toBe("$.seed: string vs number");
  });
});

describe("sha256Hex / isPng", () => {
  it("hashes deterministically", () => {
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(sha256Hex(new Uint8Array([1, 2, 3])));
    expect(sha256Hex(new Uint8Array([1]))).not.toBe(sha256Hex(new Uint8Array([2])));
  });

  it("recognizes the PNG magic", () => {
    expect(isPng(pngBytes("tile"))).toBe(true);
    expect(isPng(new TextEncoder().encode('{"error":{}}'))).toBe(false);
  });
});
