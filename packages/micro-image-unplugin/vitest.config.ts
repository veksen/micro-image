import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      // see apps/cache/vitest.config.mts for why include/exclude are spelled out
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "json-summary"],
    },
    // The integration test runs a real `vite build`, which takes a few seconds.
    testTimeout: 30_000,
  },
});
