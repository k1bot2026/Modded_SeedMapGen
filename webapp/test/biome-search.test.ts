import { describe, expect, it } from "vitest";
import {
  biomeSearchPlan,
  nearestMatchInGrid,
  type GridPatch,
} from "../src/lib/biome-search";

describe("biomeSearchPlan", () => {
  it("ring 0 is a single patch centered on the origin", () => {
    const rings = biomeSearchPlan(0, 0, { stepBlocks: 32, patchSamples: 64, maxRings: 2 });
    expect(rings[0]?.ring).toBe(0);
    expect(rings[0]?.patches).toEqual([
      { minX: -1024, minZ: -1024, step: 32, w: 64, h: 64 },
    ]);
  });

  it("ring r contains 8r patches", () => {
    const rings = biomeSearchPlan(0, 0, { maxRings: 3 });
    expect(rings.map((r) => r.patches.length)).toEqual([1, 8, 16, 24]);
  });

  it("patches tile the plane contiguously around the center patch", () => {
    const rings = biomeSearchPlan(100, -50, {
      stepBlocks: 16,
      patchSamples: 32,
      maxRings: 1,
    });
    const span = 16 * 32;
    const origin = rings[0]?.patches[0];
    expect(origin).toBeDefined();
    for (const patch of rings[1]?.patches ?? []) {
      expect(Math.abs((patch.minX - (origin?.minX ?? 0)) % span)).toBe(0);
      expect(Math.abs((patch.minZ - (origin?.minZ ?? 0)) % span)).toBe(0);
    }
  });

  it("orders patches within a ring by distance to the search center", () => {
    const rings = biomeSearchPlan(0, 0, { maxRings: 2 });
    const span = 32 * 64;
    for (const ring of rings) {
      const dists = ring.patches.map((p) =>
        Math.hypot(p.minX + span / 2, p.minZ + span / 2),
      );
      const sorted = [...dists].sort((a, b) => a - b);
      expect(dists).toEqual(sorted);
    }
  });

  it("rejects nonsense options", () => {
    expect(() => biomeSearchPlan(0, 0, { stepBlocks: 0 })).toThrow(RangeError);
    expect(() => biomeSearchPlan(0, 0, { maxRings: -1 })).toThrow(RangeError);
  });
});

describe("nearestMatchInGrid", () => {
  const patch: GridPatch = { minX: 0, minZ: 0, step: 4, w: 4, h: 4 };

  it("returns null when the target is not in the palette", () => {
    const response = { palette: ["minecraft:plains"], data: new Array(16).fill(0) as number[] };
    expect(nearestMatchInGrid(patch, response, "minecraft:desert", 0, 0)).toBeNull();
  });

  it("maps row-major data to block coordinates per the contract", () => {
    // Sample (row=2, col=3) -> block (minX + 3*4, minZ + 2*4) = (12, 8).
    const data = new Array(16).fill(0) as number[];
    data[2 * 4 + 3] = 1;
    const response = { palette: ["minecraft:plains", "minecraft:desert"], data };
    expect(nearestMatchInGrid(patch, response, "minecraft:desert", 0, 0)).toEqual({
      x: 12,
      z: 8,
      distance: Math.hypot(12, 8),
    });
  });

  it("returns the match nearest to the search center", () => {
    const data = new Array(16).fill(0) as number[];
    data[0] = 1; // block (0, 0)
    data[15] = 1; // block (12, 12)
    const response = { palette: ["a", "b"], data };
    expect(nearestMatchInGrid(patch, response, "b", 11, 11)).toEqual({
      x: 12,
      z: 12,
      distance: Math.hypot(1, 1),
    });
    expect(nearestMatchInGrid(patch, response, "b", 1, 1)).toEqual({
      x: 0,
      z: 0,
      distance: Math.hypot(1, 1),
    });
  });
});
