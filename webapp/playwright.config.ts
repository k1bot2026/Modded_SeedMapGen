import { defineConfig } from "@playwright/test";

/**
 * E2E suite: mock oracle (:8765) + vite preview (:4173), Chromium only.
 * Run `pnpm run test:e2e` (builds dist first). Browsers resolve through
 * PLAYWRIGHT_BROWSERS_PATH when set (e.g. a preinstalled /opt/pw-browsers);
 * otherwise install once with `pnpm exec playwright install chromium`.
 */
const PREVIEW_PORT = 4173;
const ORACLE_PORT = 8765;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      // WebGL via software rasterizer in headless environments.
      args: ["--enable-unsafe-swiftshader"],
    },
  },
  webServer: [
    {
      command: `node mock/mock-oracle.mjs --port ${ORACLE_PORT}`,
      url: `http://127.0.0.1:${ORACLE_PORT}/meta`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
