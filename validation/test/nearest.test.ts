import { describe, expect, it } from "vitest";
import { nearestPlacedFeature, pickNearest, SEARCH_RADII_BLOCKS } from "../src/core/nearest.js";
import type { PlacedFeature } from "../src/oracle-client.js";
import { feature } from "./helpers.js";

function queryReturning(byRadius: (radius: number) => PlacedFeature[], calls: number[]) {
  return (radius: number): Promise<readonly PlacedFeature[]> => {
    calls.push(radius);
    return Promise.resolve(byRadius(radius));
  };
}

describe("nearestPlacedFeature", () => {
  it("stops at the first radius when the hit distance is within it (d <= r proof)", async () => {
    const calls: number[] = [];
    const result = await nearestPlacedFeature(
      { x: 0, z: 0 },
      "test:widget",
      queryReturning(() => [feature("test:widget", 100, 100)], calls),
    );
    expect(result.feature).toMatchObject({ x: 100, z: 100 });
    expect(result.exact).toBe(true);
    expect(calls).toEqual([512]);
  });

  it("re-queries with ceil(d) when the only hit is in the box corner (d > r)", async () => {
    const calls: number[] = [];
    // At r=512 the nearest visible hit is the corner one at (500, 500), d ~ 707.1.
    // The settle query at r=708 exposes a genuinely closer feature at (600, 0).
    const result = await nearestPlacedFeature(
      { x: 0, z: 0 },
      "test:widget",
      queryReturning(
        (radius) =>
          radius >= 600
            ? [feature("test:widget", 500, 500), feature("test:widget", 600, 0)]
            : [feature("test:widget", 500, 500)],
        calls,
      ),
    );
    expect(calls).toEqual([512, 708]);
    expect(result.feature).toMatchObject({ x: 600, z: 0 });
    expect(result.exact).toBe(true);
  });

  it("walks the whole schedule and reports a confident not-found", async () => {
    const calls: number[] = [];
    const result = await nearestPlacedFeature({ x: 0, z: 0 }, "test:widget", queryReturning(() => [], calls));
    expect(calls).toEqual([...SEARCH_RADII_BLOCKS]);
    expect(result.feature).toBeNull();
    expect(result.exact).toBe(true);
    expect(result.searchedRadius).toBe(2560);
  });

  it("returns an inexact result when the only hit lies beyond the radius cap's circle", async () => {
    const result = await nearestPlacedFeature(
      { x: 0, z: 0 },
      "test:widget",
      // Only visible in the 2560 box, at its corner: d ~ 3606 > 2560.
      (radius) => Promise.resolve(radius >= 2560 ? [feature("test:widget", 2550, 2550)] : []),
    );
    expect(result.feature).toMatchObject({ x: 2550, z: 2550 });
    expect(result.exact).toBe(false);
    expect(result.searchedRadius).toBe(2560);
  });

  it("ignores features of other structure types", async () => {
    const result = await nearestPlacedFeature({ x: 0, z: 0 }, "test:widget", () =>
      Promise.resolve([feature("test:other", 10, 10)]),
    );
    expect(result.feature).toBeNull();
  });
});

describe("pickNearest", () => {
  it("breaks distance ties deterministically by smaller x, then z", () => {
    const tied = [feature("t", 100, 0), feature("t", -100, 0)];
    expect(pickNearest(tied, { x: 0, z: 0 })).toMatchObject({ x: -100 });
    const tiedZ = [feature("t", 0, 100), feature("t", 0, -100)];
    expect(pickNearest(tiedZ, { x: 0, z: 0 })).toMatchObject({ z: -100 });
  });

  it("throws on an empty list", () => {
    expect(() => pickNearest([], { x: 0, z: 0 })).toThrow(RangeError);
  });
});
