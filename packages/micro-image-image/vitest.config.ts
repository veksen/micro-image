import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // providers are pure and run in node; component/hook tests opt into jsdom
    // via a `@vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    benchmark: { include: ["src/**/*.bench.ts"] },
    globals: false,
    coverage: {
      provider: "v8",
      // see apps/cache/vitest.config.mts for why include/exclude are spelled out
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.bench.ts",
        "src/**/*.d.ts",
        "src/**/test-helpers.tsx",
      ],
      reporter: ["text", "json-summary"],
    },
  },
});
