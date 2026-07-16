import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests must never touch the network: everything HTTP goes through an
    // injected FetchLike, and tests inject fakes.
    environment: "node",
  },
});
