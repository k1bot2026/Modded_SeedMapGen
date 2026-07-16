import { describe, expect, it } from "vitest";
import { assessCacheHits, median, type TileFetchSample } from "../src/commands/gates.js";

function sample(elapsedMs: number, xCache: string | null = null): TileFetchSample {
  return { path: "/tiles/minecraft:overworld/64/0/0/0.png", elapsedMs, xCache, sha256: "h", isPng: true };
}

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("assessCacheHits", () => {
  it("prefers the X-Cache header when every second-pass response has one", () => {
    const verdict = assessCacheHits([sample(100)], [sample(90, "HIT"), sample(80, "hit")]);
    expect(verdict).toMatchObject({ ok: true, method: "x-cache" });
  });

  it("fails on an X-Cache miss", () => {
    const verdict = assessCacheHits([sample(100)], [sample(5, "MISS"), sample(5, "HIT")]);
    expect(verdict.ok).toBe(false);
    expect(verdict.method).toBe("x-cache");
    expect(verdict.detail).toContain("MISS");
  });

  it("falls back to the timing heuristic: second-pass median must halve (or be <= 30 ms)", () => {
    const cold = Array.from({ length: 25 }, () => sample(200));
    const warm = Array.from({ length: 25 }, () => sample(10));
    expect(assessCacheHits(cold, warm)).toMatchObject({ ok: true, method: "timing" });

    const stillCold = Array.from({ length: 25 }, () => sample(180));
    const verdict = assessCacheHits(cold, stillCold);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("timing heuristic");
  });

  it("does not fail an already-warm first pass and says so", () => {
    const warm = Array.from({ length: 25 }, () => sample(8));
    const verdict = assessCacheHits(warm, warm);
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("already warm");
  });
});
