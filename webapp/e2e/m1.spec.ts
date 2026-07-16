import { expect, test } from "@playwright/test";
import type { SeedmapDebug } from "../src/debug-types";

const APP = "/?oracle=http://127.0.0.1:8765";

declare global {
  interface Window {
    __seedmap?: SeedmapDebug;
  }
}

async function waitForReady(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => window.__seedmap?.ready === true, undefined, {
    timeout: 60_000,
  });
}

test("banner shows the Mockpack meta", async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(".banner-pack")).toContainText("Mockpack");
  await expect(page.locator(".banner-pack")).toContainText("1.0.0");
  await expect(page.locator(".banner")).toContainText("MC 1.21.1");
  await expect(page.locator(".banner")).toContainText("1234"); // seed chip
});

test("map canvas paints oracle tiles", async ({ page }) => {
  await page.goto(`${APP}#minecraft:overworld/0/0/6`);
  await waitForReady(page);
  await page.waitForFunction(() => (window.__seedmap?.tilesLoaded ?? 0) > 0);
  await page.evaluate(() => window.__seedmap?.onIdle());
  const tiles = await page.evaluate(() => window.__seedmap?.tilesLoaded ?? 0);
  expect(tiles).toBeGreaterThanOrEqual(4);

  const screenshot = await page.screenshot({ path: "test-results/m1-map.png" });
  // An unpainted (solid) canvas compresses to a few KB; organic biome tiles
  // are far larger. Guards against a silently-black WebGL context.
  expect(screenshot.byteLength).toBeGreaterThan(20_000);
});

test("structure marker layer toggles on and off", async ({ page }) => {
  await page.goto(`${APP}#minecraft:overworld/0/0/9`);
  await waitForReady(page);

  const checkbox = page.locator('input[data-structure-id="minecraft:village_plains"]');
  await checkbox.check();
  await page.waitForFunction(() => (window.__seedmap?.lastStructureCount ?? -1) > 0);
  await page.evaluate(() => window.__seedmap?.onIdle());
  const rendered = await page.evaluate(
    () => window.__seedmap?.queryStructureFeatures() ?? 0,
  );
  expect(rendered).toBeGreaterThan(0);

  await checkbox.uncheck();
  await page.waitForFunction(() => window.__seedmap?.lastStructureCount === 0);
  await page.evaluate(() => window.__seedmap?.onIdle());
  const cleared = await page.evaluate(
    () => window.__seedmap?.queryStructureFeatures() ?? 0,
  );
  expect(cleared).toBe(0);

  // Toggling also updates the shareable hash.
  await checkbox.check();
  await page.waitForFunction(() =>
    window.location.hash.includes("layers=minecraft:village_plains"),
  );
});
