import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  deps: {
    neverBundle: ["react", "react-dom"],
  },
});
