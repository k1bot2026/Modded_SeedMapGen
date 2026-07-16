import { describe, expect, it } from "vitest";
import {
  compactLayerTokens,
  expandLayerTokens,
  groupByNamespace,
} from "../src/lib/layer-tokens";

const ALL = [
  "minecraft:village_plains",
  "minecraft:desert_pyramid",
  "terralith:spire",
  "cobbleverse:gym_fire",
  "cobbleverse:gym_water",
];

describe("groupByNamespace", () => {
  it("groups ids preserving membership", () => {
    const groups = groupByNamespace(ALL);
    expect([...groups.keys()].sort()).toEqual(["cobbleverse", "minecraft", "terralith"]);
    expect(groups.get("cobbleverse")).toEqual([
      "cobbleverse:gym_fire",
      "cobbleverse:gym_water",
    ]);
  });
});

describe("compactLayerTokens", () => {
  it("collapses fully-enabled namespaces to ns:*", () => {
    const enabled = new Set(["cobbleverse:gym_fire", "cobbleverse:gym_water"]);
    expect(compactLayerTokens(enabled, ALL)).toEqual(["cobbleverse:*"]);
  });

  it("lists partial namespaces individually", () => {
    const enabled = new Set(["minecraft:village_plains", "cobbleverse:gym_fire"]);
    expect(compactLayerTokens(enabled, ALL)).toEqual([
      "cobbleverse:gym_fire",
      "minecraft:village_plains",
    ]);
  });

  it("returns [] when nothing is enabled", () => {
    expect(compactLayerTokens(new Set(), ALL)).toEqual([]);
  });
});

describe("expandLayerTokens", () => {
  it("expands ns:* into all known ids of the namespace", () => {
    expect([...expandLayerTokens(["cobbleverse:*"], ALL)].sort()).toEqual([
      "cobbleverse:gym_fire",
      "cobbleverse:gym_water",
    ]);
  });

  it("keeps known ids and drops unknown ones", () => {
    expect([
      ...expandLayerTokens(["minecraft:village_plains", "modded:thing"], ALL),
    ]).toEqual(["minecraft:village_plains"]);
  });

  it("round-trips compact -> expand", () => {
    const enabled = new Set([
      "minecraft:village_plains",
      "terralith:spire",
      "cobbleverse:gym_fire",
      "cobbleverse:gym_water",
    ]);
    const tokens = compactLayerTokens(enabled, ALL);
    expect(expandLayerTokens(tokens, ALL)).toEqual(enabled);
  });
});
