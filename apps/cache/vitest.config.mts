import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    benchmark: { include: ["src/**/*.bench.ts"] },
    // sharp + real HTTP round trips are slower than the 5s default
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // NOTE: do not set `pool: "forks"` here. The in-memory cache is a module
    // singleton, but the default pool already isolates each test file in its
    // own worker and every suite calls clearCache() itself. The forks pool
    // serializes results over child_process IPC, which throws
    // "RangeError: Invalid array length" on the Buffers the benchmarks hold.
    coverage: {
      provider: "v8",
      // `include` defaults to "files a test imported", which scores a module
      // nobody tests as absent rather than as 0%. Naming src/** instead keeps
      // untested files in the denominator, which is the number worth reporting.
      include: ["src/**/*.ts"],
      // vitest 4 ships an empty default `exclude`, so the suite's own files
      // have to be dropped here or they inflate every metric.
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.bench.ts",
        "src/**/*.d.ts",
        // scaffolding the suite imports; covering it measures the tests
        "src/**/test-helpers.ts",
      ],
      // json-summary is what scripts/coverage-comment.mjs reads; text is for
      // reading a local run. No html/clover — nothing consumes them, and they
      // are the bulk of the CI artifact.
      reporter: ["text", "json-summary"],
    },
  },
});
