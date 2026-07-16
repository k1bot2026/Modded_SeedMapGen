/**
 * Deterministic PRNG for the harness (mulberry32): reproducible random origins
 * and request parameters so `--seed-rng 42` always exercises the same points.
 * Harness plumbing only — nothing to do with Minecraft's RNG or world seeds
 * (those stay strings end-to-end, per the contract).
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(minInclusive, maxInclusive) {
      if (maxInclusive < minInclusive) {
        throw new RangeError(`int(${minInclusive}, ${maxInclusive}): empty range`);
      }
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    pick(items) {
      if (items.length === 0) throw new RangeError("pick() from an empty array");
      return items[Math.floor(next() * items.length)]!;
    },
  };
}

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Stable per-label stream: the same base seed + label always yields the same
 * sequence, independent of how many draws other labels made (so adding a
 * dimension does not shift every other dimension's origins).
 */
export function deriveRng(baseSeed: number, label: string): Rng {
  return createRng(((baseSeed >>> 0) ^ fnv1a32(label)) >>> 0);
}
