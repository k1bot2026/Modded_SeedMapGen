import { UserError } from "../errors.js";

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/**
 * Validate and canonicalize a Minecraft seed.
 *
 * Seeds are signed 64-bit longs and travel as strings end-to-end (JSON numbers
 * lose precision above 2^53). Accepts an optionally signed decimal integer,
 * returns the canonical decimal string ("+0012" -> "12").
 *
 * Text seeds (Minecraft hashes them via String.hashCode) are rejected on
 * purpose: the map is only meaningful for the exact numeric seed, which the
 * user gets from `/seed` in-game.
 */
export function parseSeed(input: string): string {
  const trimmed = input.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new UserError(
      `Invalid seed ${JSON.stringify(input)}: expected a decimal integer. ` +
        `Run /seed in-game to get the numeric world seed.`,
    );
  }
  const value = BigInt(trimmed);
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new UserError(
      `Seed ${trimmed} is outside the signed 64-bit range [${INT64_MIN}, ${INT64_MAX}].`,
    );
  }
  return value.toString();
}

/** Parse a comma-separated candidate list for verify-seed. */
export function parseSeedList(input: string): string[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new UserError("Empty candidate seed list.");
  }
  const seeds = parts.map(parseSeed);
  const unique = new Set(seeds);
  if (unique.size !== seeds.length) {
    throw new UserError("Duplicate seeds in candidate list.");
  }
  return seeds;
}
