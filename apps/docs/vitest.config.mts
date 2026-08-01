import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js requires `jsx: "preserve"` in tsconfig so it can run its own JSX
  // transform. Vite honours that setting and would hand un-transformed JSX to
  // import analysis, so the test run overrides it with the automatic runtime.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    coverage: {
      provider: "v8",
      // see apps/cache/vitest.config.mts for why include/exclude are spelled out
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/__tests__/**",
        "src/**/*.d.ts",
        // scaffolding the suite imports; covering it measures the tests
        "src/**/test-helpers.ts",
        // The rendered pages are Next.js's to call, not something a test
        // imports; counting them reports the docs site as mostly uncovered and
        // drowns the packages this number is actually about. Scoped to the
        // direct .tsx children on purpose — src/pages/api/meta.ts is the ?meta
        // endpoint, it has its own suite, and it belongs in the report.
        "src/pages/*.tsx",
      ],
      reporter: ["text", "json-summary"],
    },
  },
});
