import react from "@vitejs/plugin-react";
import microImage from "@micro-image/unplugin/vite";
import microImageReact from "@micro-image/plugin-react/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    // The adapter finds <Image src="./x.jpg"> and points it at the core's loader.
    microImageReact(),
    // The core reads each image at build time. The proxy fetches the source by
    // URL, so a build needs the origin the site is served from. In dev the core
    // uses the dev server's own URL.
    microImage({
      origin:
        command === "build" ? (process.env.SITE_ORIGIN ?? "http://localhost:4173") : undefined,
    }),
    react(),
  ],
}));
