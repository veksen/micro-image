import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // providers are pure and run in node; component/hook tests opt into jsdom
    // via a `@vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    benchmark: { include: ["src/**/*.bench.ts"] },
    globals: false,
  },
});
