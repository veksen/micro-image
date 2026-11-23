import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts"],
  format: ["esm"],
  dts: true,
  deps: {
    neverBundle: ["@babel/parser", "@babel/traverse", "magic-string", "unplugin", "vite"],
  },
});
