import { describe, expect, it } from "vitest";
import { FixtureError } from "../src/errors.js";
import {
  BASELINE_BIOME_POINTS,
  BASELINE_LOCATES,
  parseTerralithFixture,
  parseVanillaFixture,
} from "../src/core/fixture.js";

const POPULATED = {
  status: "populated",
  seed: "1234",
  recordedBy: "owner@mac-mini",
  recordedAt: "2026-07-16T12:00:00.000Z",
  oracle: { mcVersion: "1.21.1", oracleModVersion: "0.1.0", packFingerprint: "sha256:abc" },
  biomes: [{ dim: "minecraft:overworld", x: 0, y: 64, z: 0, expected: "minecraft:plains" }],
  locates: [
    {
      dim: "minecraft:overworld",
      originX: 0,
      originZ: 0,
      structure: "#minecraft:village",
      expected: { x: 100, z: -200 },
    },
    { dim: "minecraft:the_end", originX: 0, originZ: 0, structure: "minecraft:end_city", expected: "not_found" },
  ],
};

describe("parseVanillaFixture", () => {
  it("accepts the unpopulated shape", () => {
    const fixture = parseVanillaFixture({ status: "unpopulated", seed: "1234", howToPopulate: "run --record" });
    expect(fixture.status).toBe("unpopulated");
    expect(fixture.seed).toBe("1234");
  });

  it("accepts the populated shape including not_found locates", () => {
    const fixture = parseVanillaFixture(POPULATED);
    expect(fixture.status).toBe("populated");
    if (fixture.status === "populated") {
      expect(fixture.biomes).toHaveLength(1);
      expect(fixture.locates[1]!.expected).toBe("not_found");
    }
  });

  it("rejects a numeric seed with a precision explanation", () => {
    expect(() => parseVanillaFixture({ status: "unpopulated", seed: 1234, howToPopulate: "x" })).toThrow(
      /seed.*string/i,
    );
  });

  it("rejects unknown status values and non-objects", () => {
    expect(() => parseVanillaFixture({ status: "recorded" })).toThrow(FixtureError);
    expect(() => parseVanillaFixture([1, 2])).toThrow(FixtureError);
    expect(() => parseVanillaFixture(null)).toThrow(FixtureError);
  });

  it("rejects a populated fixture with a malformed locate expectation", () => {
    const bad = structuredClone(POPULATED) as Record<string, unknown>;
    (bad["locates"] as Record<string, unknown>[])[0]!["expected"] = "maybe";
    expect(() => parseVanillaFixture(bad)).toThrow(FixtureError);
  });

  it("names the fixture path in error messages", () => {
    expect(() => parseVanillaFixture({}, "fixtures/vanilla-1.21.1.json")).toThrow(/vanilla-1\.21\.1\.json/);
  });
});

describe("parseTerralithFixture", () => {
  it("accepts unpopulated and populated shapes", () => {
    expect(parseTerralithFixture({ status: "unpopulated", howToPopulate: "record it" }).status).toBe("unpopulated");
    const populated = parseTerralithFixture({
      status: "populated",
      dim: "minecraft:overworld",
      x: 128,
      y: 64,
      z: -640,
      expectedBiome: "terralith:alpine_grove",
      recordedBy: "owner@mac-mini",
      recordedAt: "2026-07-16T12:00:00.000Z",
      oracle: { packVersion: "1.7.2", packFingerprint: "sha256:abc" },
    });
    expect(populated.status).toBe("populated");
    if (populated.status === "populated") expect(populated.expectedBiome).toBe("terralith:alpine_grove");
  });

  it("rejects missing coordinates", () => {
    expect(() =>
      parseTerralithFixture({ status: "populated", dim: "minecraft:overworld", expectedBiome: "terralith:x" }),
    ).toThrow(FixtureError);
  });
});

describe("baseline sampling plan", () => {
  it("covers all three vanilla dimensions and cave depths", () => {
    const dims = new Set(BASELINE_BIOME_POINTS.map((p) => p.dim));
    expect(dims).toEqual(new Set(["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"]));
    expect(BASELINE_BIOME_POINTS.some((p) => p.y < 0)).toBe(true);
  });

  it("locates villages and strongholds per the M1 spec", () => {
    const structures = new Set(BASELINE_LOCATES.map((l) => l.structure));
    expect(structures.has("#minecraft:village")).toBe(true);
    expect(structures.has("minecraft:stronghold")).toBe(true);
  });
});
