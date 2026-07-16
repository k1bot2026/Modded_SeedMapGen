import { describe, expect, it } from "vitest";
import { formatHash, parseHash, type HashState } from "../src/lib/hash-state";

describe("formatHash", () => {
  it("formats dim/x/z/zoom", () => {
    expect(formatHash({ dim: "minecraft:overworld", x: 100, z: -200, zoom: 6 })).toBe(
      "#minecraft:overworld/100/-200/6",
    );
  });

  it("rounds coordinates and trims zoom to 2 decimals", () => {
    expect(
      formatHash({ dim: "minecraft:the_end", x: 10.6, z: -0.4, zoom: 7.256 }),
    ).toBe("#minecraft:the_end/11/0/7.26");
  });

  it("appends layers csv only when non-empty", () => {
    expect(
      formatHash({
        dim: "minecraft:overworld",
        x: 0,
        z: 0,
        zoom: 5,
        layers: ["cobbleverse:*", "minecraft:village_plains"],
      }),
    ).toBe("#minecraft:overworld/0/0/5/layers=cobbleverse:*,minecraft:village_plains");
    expect(
      formatHash({ dim: "minecraft:overworld", x: 0, z: 0, zoom: 5, layers: [] }),
    ).toBe("#minecraft:overworld/0/0/5");
  });
});

describe("parseHash", () => {
  it("parses a full hash", () => {
    expect(
      parseHash("#minecraft:overworld/1424/-368/8.5/layers=terralith:*,cobbleverse:gym_fire"),
    ).toEqual({
      dim: "minecraft:overworld",
      x: 1424,
      z: -368,
      zoom: 8.5,
      layers: ["terralith:*", "cobbleverse:gym_fire"],
    });
  });

  it("parses without the leading '#' and without layers", () => {
    expect(parseHash("minecraft:the_nether/-10/20/4")).toEqual({
      dim: "minecraft:the_nether",
      x: -10,
      z: 20,
      zoom: 4,
    });
  });

  it("round-trips through formatHash", () => {
    const states: HashState[] = [
      { dim: "minecraft:overworld", x: 0, z: 0, zoom: 6 },
      { dim: "terralith:skylands", x: -524288, z: 524287, zoom: 10.25 },
      {
        dim: "minecraft:the_end",
        x: 42,
        z: -42,
        zoom: 4,
        layers: ["minecraft:end_city"],
      },
    ];
    for (const state of states) {
      expect(parseHash(formatHash(state))).toEqual(state);
    }
  });

  it("returns null for junk", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#")).toBeNull();
    expect(parseHash("#overworld/0/0/6")).toBeNull(); // dim must be namespaced
    expect(parseHash("#minecraft:overworld/0/0")).toBeNull(); // missing zoom
    expect(parseHash("#minecraft:overworld/a/0/6")).toBeNull(); // NaN coord
    expect(parseHash("#minecraft:overworld/0//6")).toBeNull(); // empty coord
    expect(parseHash("#minecraft:overworld/0/0/6/bogus=1")).toBeNull(); // unknown extra
    expect(parseHash("#minecraft:overworld/0/0/6/layers=a,b/extra")).toBeNull();
  });

  it("drops empty layer tokens; all-empty csv means no layers key", () => {
    expect(parseHash("#minecraft:overworld/0/0/6/layers=a,,b")).toEqual({
      dim: "minecraft:overworld",
      x: 0,
      z: 0,
      zoom: 6,
      layers: ["a", "b"],
    });
    expect(parseHash("#minecraft:overworld/0/0/6/layers=")).toEqual({
      dim: "minecraft:overworld",
      x: 0,
      z: 0,
      zoom: 6,
    });
  });
});
