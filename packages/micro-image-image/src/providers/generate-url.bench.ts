import { bench, describe } from "vitest";
import { generateUrl as microImage } from "./micro-image";
import { generateUrl as ipx } from "./ipx";
import { generateUrl as imgproxy } from "./imgproxy";
import type { IProviderOptions } from "./base";

/**
 * These run on the client, on every render of every image.
 *
 * The single-call numbers are not the interesting ones. `generateSrcSet` builds
 * 19 candidate URLs per image, and it is not memoised against anything but the
 * props object, so a page with 30 images pays 570 of these per render pass.
 * The srcset case below is the one that matters.
 */
const SRC = "https://images.example.com/photos/2024/summer/cat-on-a-roof.jpg?v=3";
const BASE = "http://localhost:4000/cache";

const options: IProviderOptions = { url: BASE, src: SRC, width: 800, quality: 75 };

const budget = { time: 300, warmupTime: 50 };

describe("generateUrl — single call", () => {
  bench("micro-image", () => void microImage(options), budget);
  bench("ipx", () => void ipx(options), budget);
  bench("imgproxy", () => void imgproxy(options), budget);
});

/** Mirrors generateSrcSet in image.component.tsx: 19 widths, 100w to 1900w. */
function srcSet(generator: (o: IProviderOptions) => string) {
  return Array.from({ length: 20 })
    .map((_, index) => index)
    .slice(1)
    .map((index) => {
      const width = index * 100;
      return `${generator({ url: BASE, src: SRC, width, quality: 75 })} ${width}w`;
    })
    .join(", ");
}

describe("generateSrcSet — 19 candidates, once per image per render", () => {
  bench("micro-image", () => void srcSet(microImage), budget);
  bench("ipx", () => void srcSet(ipx), budget);
  bench("imgproxy", () => void srcSet(imgproxy), budget);
});
