import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // sharp + real HTTP round trips are slower than the 5s default
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // the in-memory cache is a module singleton; keep files from racing on it
    pool: "forks",
  },
});
