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
  },
});
