import { fileURLToPath } from "node:url";

/**
 * Default fixture locations, resolved relative to this module so the `validate`
 * bin works from any cwd. src/ and dist/ sit at the same depth, so ../fixtures
 * lands on the package's fixtures/ directory in both dev and built form.
 */
export function defaultVanillaFixturePath(): string {
  return fileURLToPath(new URL("../fixtures/vanilla-1.21.1.json", import.meta.url));
}

export function defaultTerralithFixturePath(): string {
  return fileURLToPath(new URL("../fixtures/terralith-m2.json", import.meta.url));
}
