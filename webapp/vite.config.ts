import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
