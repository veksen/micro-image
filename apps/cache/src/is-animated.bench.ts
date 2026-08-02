import { bench, describe } from "vitest";
import { isAnimated } from "./is-animated";
import { makeJpeg, makeSharpAnimatedGif } from "./test-helpers";

/**
 * The probe now runs on every transformable request, not just on GIFs, and it
 * calls into libvips instead of reading a handful of bytes. ADR 0010 flags that
 * as "new per-request work on the hot path" and leaves the size of it open.
 * This measures it.
 *
 * What matters is the shape, not the absolute number: `metadata()` reads the
 * header, so the cost should be flat in payload size. If it ever tracks payload
 * size, something is decoding that should not be.
 *
 * This replaces the BUG-20 benchmark, which measured a byte-by-byte buffer copy
 * in a module that no longer exists.
 */

const budget = { time: 300, warmupTime: 50 };

const jpegSmall = await makeJpeg({ width: 64, height: 64 });
const jpegLarge = await makeJpeg({ width: 1600, height: 1200, content: "noise" });
const gifSmall = await makeSharpAnimatedGif({ width: 32, height: 32, frames: 3 });
const gifLarge = await makeSharpAnimatedGif({ width: 320, height: 240, frames: 30 });

const cases: Array<[string, Buffer]> = [
  ["still jpeg 64x64", jpegSmall],
  ["still jpeg 1600x1200", jpegLarge],
  ["animated gif 32x32 x3", gifSmall],
  ["animated gif 320x240 x30", gifLarge],
];

for (const [label, buffer] of cases) {
  describe(`isAnimated — ${label} (${Math.round(buffer.length / 1024)} kB)`, () => {
    bench(
      "header read via metadata()",
      async () => {
        await isAnimated(buffer);
      },
      budget
    );
  });
}
