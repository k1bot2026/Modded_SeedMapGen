import { describe, expect, it } from "vitest";
import { createRng, deriveRng, fnv1a32 } from "../src/rng.js";

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const drawsA = Array.from({ length: 10 }, () => a.int(-20000, 20000));
    const drawsB = Array.from({ length: 10 }, () => b.int(-20000, 20000));
    expect(drawsA).toEqual(drawsB);
  });

  it("differs across seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    const drawsA = Array.from({ length: 10 }, () => a.next());
    const drawsB = Array.from({ length: 10 }, () => b.next());
    expect(drawsA).not.toEqual(drawsB);
  });

  it("int stays within inclusive bounds", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(-3, 3);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThanOrEqual(3);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("int rejects an empty range and pick rejects an empty array", () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("pick returns members of the array", () => {
    const rng = createRng(9);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });
});

describe("deriveRng", () => {
  it("same base + label yields the same stream; different labels diverge", () => {
    const first = Array.from({ length: 5 }, () => deriveRng(42, "minecraft:overworld").next())[0];
    const again = deriveRng(42, "minecraft:overworld").next();
    expect(first).toBe(again);
    expect(deriveRng(42, "minecraft:overworld").next()).not.toBe(deriveRng(42, "minecraft:the_nether").next());
  });

  it("fnv1a32 is stable", () => {
    expect(fnv1a32("minecraft:overworld")).toBe(fnv1a32("minecraft:overworld"));
    expect(fnv1a32("a")).not.toBe(fnv1a32("b"));
  });
});
