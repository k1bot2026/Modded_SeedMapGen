import { describe, expect, it } from "vitest";
import { parseSeed, parseSeedList } from "../src/core/seed.js";
import { UserError } from "../src/errors.js";

describe("parseSeed", () => {
  it("accepts plain positive seeds", () => {
    expect(parseSeed("1234")).toBe("1234");
  });

  it("accepts negative seeds", () => {
    expect(parseSeed("-1234567890123456789")).toBe("-1234567890123456789");
  });

  it("accepts the exact 64-bit bounds", () => {
    expect(parseSeed("9223372036854775807")).toBe("9223372036854775807");
    expect(parseSeed("-9223372036854775808")).toBe("-9223372036854775808");
  });

  it("rejects values outside the signed 64-bit range", () => {
    expect(() => parseSeed("9223372036854775808")).toThrow(UserError);
    expect(() => parseSeed("-9223372036854775809")).toThrow(UserError);
  });

  it("preserves precision beyond 2^53 (never routes through Number)", () => {
    // 2^53 + 1 is not representable as a JS number.
    expect(parseSeed("9007199254740993")).toBe("9007199254740993");
  });

  it("canonicalizes leading zeros, plus signs, and whitespace", () => {
    expect(parseSeed("0012")).toBe("12");
    expect(parseSeed("+5")).toBe("5");
    expect(parseSeed(" 42 ")).toBe("42");
    expect(parseSeed("-0")).toBe("0");
  });

  it("rejects text seeds with a pointer to /seed", () => {
    expect(() => parseSeed("glacier")).toThrow(/\/seed/);
    expect(() => parseSeed("12.5")).toThrow(UserError);
    expect(() => parseSeed("")).toThrow(UserError);
    expect(() => parseSeed("0x12")).toThrow(UserError);
  });
});

describe("parseSeedList", () => {
  it("splits, trims, and canonicalizes", () => {
    expect(parseSeedList("1, -2 ,0003")).toEqual(["1", "-2", "3"]);
  });

  it("rejects duplicates (post-canonicalization)", () => {
    expect(() => parseSeedList("7,007")).toThrow(/Duplicate/);
  });

  it("rejects empty lists", () => {
    expect(() => parseSeedList(" , ")).toThrow(UserError);
  });
});
