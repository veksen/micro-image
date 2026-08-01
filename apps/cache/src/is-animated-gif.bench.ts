import { bench, describe } from "vitest";
import { isAnimatedGif } from "./is-animated-gif";
import { makeGif } from "./test-helpers";

/**
 * BUG-20: `toArrayBuffer` allocates a fresh ArrayBuffer and copies the whole
 * payload one byte at a time in a JS loop, purely to read about eight bytes
 * near the front. The cost is proportional to the payload, so it scales with
 * exactly the images the proxy exists to handle.
 *
 * `readDirect` is the reference: identical parse, no copy. It is not a proposed
 * fix; it exists to put a number on the waste.
 *
 * BUG-19 (the `Buffer.from(data, "binary")` copy) is deliberately not measured
 * here. It is a Node built-in doing a memcpy, the result is a foregone
 * conclusion, and benchmarking it allocates megabytes per iteration. Its real
 * cost shows up in the end-to-end cold latency in benchmark/proxy.bench.ts.
 */
function readDirect(buffer: Buffer): boolean {
  const HEADER_LEN = 6;
  const LOGICAL_SCREEN_DESC_LEN = 7;
  const base = HEADER_LEN + LOGICAL_SCREEN_DESC_LEN - 3;

  const globalColorTable = buffer.readUInt8(base);
  let globalColorTableSize = 0;
  if (globalColorTable & 0x80) {
    globalColorTableSize = 3 * 2 ** ((globalColorTable & 0x7) + 1);
  }

  const offset = 3 + globalColorTableSize;
  const extensionIntroducer = buffer.readUInt8(base + offset);
  const graphicsControlLabel = buffer.readUInt8(base + offset + 1);
  let delayTime = 0;

  if (extensionIntroducer & 0x21 && graphicsControlLabel & 0xf9) {
    delayTime = buffer.readUInt16BE(base + offset + 4);
  }

  return delayTime > 0;
}

const smallGif = makeGif({ delay: 10 });

/** A gif header followed by filler, standing in for a real payload. */
function padded(bytes: number): Buffer {
  return Buffer.concat([smallGif, Buffer.alloc(Math.max(0, bytes - smallGif.length))]);
}

// capped at 512 kB: the copy allocates the full payload on every call, so
// larger sizes spend the whole run in GC rather than in the function
const sizes: Array<[string, Buffer]> = [
  ["64 B", smallGif],
  ["64 kB", padded(64 * 1024)],
  ["512 kB", padded(512 * 1024)],
];

// keep each case to a fixed time budget so the suite stays quick and bounded
const budget = { time: 300, warmupTime: 50 };

for (const [label, buffer] of sizes) {
  describe(`isAnimatedGif — ${label}`, () => {
    bench(
      "current (copies the whole buffer byte by byte)",
      () => {
        isAnimatedGif(buffer);
      },
      budget
    );

    bench(
      "reference (reads in place)",
      () => {
        readDirect(buffer);
      },
      budget
    );
  });
}
