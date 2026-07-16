import { describe, expect, it } from "vitest";
import { classifyLocateAgreement } from "../src/core/agreement.js";
import type { NearestResult } from "../src/core/nearest.js";
import { feature } from "./helpers.js";

const found = (x: number, z: number) => ({ found: true as const, structure: "test:widget", x, z, distance: Math.hypot(x, z) });
const notFound = { found: false as const };
const nearest = (x: number, z: number, exact = true): NearestResult => ({
  feature: feature("test:widget", x, z),
  searchedRadius: 2560,
  exact,
});
const nothing: NearestResult = { feature: null, searchedRadius: 2560, exact: true };

describe("classifyLocateAgreement", () => {
  it("agrees when both found the same position", () => {
    expect(classifyLocateAgreement(found(100, -200), nearest(100, -200))).toEqual({
      agree: true,
      kind: "matched_position",
    });
  });

  it("agrees when both found nothing within the search radius", () => {
    expect(classifyLocateAgreement(notFound, nothing)).toEqual({ agree: true, kind: "both_not_found" });
  });

  it("flags a position mismatch with both answers in the reason", () => {
    const verdict = classifyLocateAgreement(found(100, -200), nearest(96, -208));
    expect(verdict.agree).toBe(false);
    if (!verdict.agree) {
      expect(verdict.reason).toContain("(100, -200)");
      expect(verdict.reason).toContain("(96, -208)");
    }
  });

  it("flags /locate finding something the placed-search missed", () => {
    const verdict = classifyLocateAgreement(found(100, -200), nothing);
    expect(verdict.agree).toBe(false);
    if (!verdict.agree) expect(verdict.reason).toContain("nothing within 2560");
  });

  it("flags the placed-search finding something /locate missed", () => {
    const verdict = classifyLocateAgreement(notFound, nearest(96, -208));
    expect(verdict.agree).toBe(false);
    if (!verdict.agree) expect(verdict.reason).toContain("not_found");
  });
});
