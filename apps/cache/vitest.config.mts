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
  },
});
