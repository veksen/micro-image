import { describe, it, expect } from "vitest";
import { isAnimatedGif } from "./is-animated-gif";
import { makeGif, makeJpeg, makePng } from "./test-helpers";

describe("isAnimatedGif — real gifs", () => {
  it("detects a gif with a non-zero delay time", () => {
    expect(isAnimatedGif(makeGif({ delay: 10 }))).toBe(true);
  });

  it("reports a gif with a zero delay time as not animated", () => {
    expect(isAnimatedGif(makeGif({ delay: 0 }))).toBe(false);
  });

  it("handles a gif with no global colour table", () => {
    expect(isAnimatedGif(makeGif({ delay: 10, globalColorTable: false }))).toBe(true);
  });

  it("accounts for global colour table size when locating the extension block", () => {
    for (const exponent of [0, 1, 2, 3, 7]) {
      expect(
        isAnimatedGif(makeGif({ delay: 10, colorTableSizeExponent: exponent })),
        `colour table exponent ${exponent}`
      ).toBe(true);
    }
  });

  it("reports a gif with no graphics control extension as not animated", () => {
    expect(isAnimatedGif(makeGif({ delay: 0, graphicsControlExtension: false }))).toBe(false);
  });
});

/**
 * BUG-18 is materially worse than "theoretically possible". The route calls
 * isAnimatedGif on every supported mime with no `contentType === "image/gif"`
 * guard. For a JPEG, byte 10 — where this function expects the GIF logical
 * screen descriptor — is the first quantization-table entry, whose value is
 * determined by the encoder's quality setting.
 *
 * The guard `extensionIntroducer & 0x21 && graphicsControlLabel & 0xf9` uses
 * bitwise AND instead of equality, so it passes on any byte pair sharing a
 * single bit with those masks. Measured on 64x64 gradient JPEGs:
 *
 *   quality  byte10  intro  label  => detected as animated gif
 *   50       0x0e    0x10   0x0e   no
 *   60       0x0b    0x0d   0x0b   YES  (delay read as 3598)
 *   75       0x07    0x08   0x07   no
 *   80       0x06    0x06   0x06   no
 *   90       0x03    0x03   0x03   YES  (delay read as 1027)
 *   100      0x01    0x01   0x01   YES  (delay read as 257)
 *
 * A false positive means the route returns the ORIGINAL bytes uncompressed and
 * unresized, and caches that. See the end-to-end consequence in server.test.ts.
 */
describe("isAnimatedGif — false positives on non-gif input [BUG-18]", () => {
  it("misidentifies a quality-100 jpeg as an animated gif", async () => {
    expect(isAnimatedGif(await makeJpeg({ width: 64, height: 64 }))).toBe(true);
  });

  it("is decided purely by the jpeg quantization table, not by the image", async () => {
    const detected: number[] = [];

    for (const quality of [50, 60, 70, 75, 80, 85, 90, 95, 100]) {
      const jpeg = await makeJpeg({ width: 64, height: 64, quality });
      if (isAnimatedGif(jpeg)) detected.push(quality);
    }

    // same picture, same dimensions — only the encoder quality differs
    expect(detected).toEqual([60, 90, 100]);
  });

  it("does not currently misfire on png", async () => {
    expect(isAnimatedGif(await makePng({ width: 64, height: 64 }))).toBe(false);
  });
});

describe("bug ledger", () => {
  it.fails("BUG-18: a jpeg should never be reported as an animated gif", async () => {
    const jpeg = await makeJpeg({ width: 64, height: 64, quality: 100 });
    expect(isAnimatedGif(jpeg)).toBe(false);
  });

  it.fails("BUG-18: no jpeg quality should be reported as an animated gif", async () => {
    const detected: number[] = [];

    for (const quality of [50, 60, 70, 75, 80, 85, 90, 95, 100]) {
      const jpeg = await makeJpeg({ width: 64, height: 64, quality });
      if (isAnimatedGif(jpeg)) detected.push(quality);
    }

    expect(detected).toEqual([]);
  });

  it.fails("BUG-18: extension bytes should be matched by equality, not bitwise AND", () => {
    // 0x20/0xf8 are not GCE markers, but each shares a bit with the masks
    const gif = makeGif({ delay: 10 });
    const gceOffset = gif.indexOf(Buffer.from([0x21, 0xf9]));
    expect(gceOffset).toBeGreaterThan(-1);

    gif.writeUInt8(0x20, gceOffset);
    gif.writeUInt8(0xf8, gceOffset + 1);

    expect(isAnimatedGif(gif)).toBe(false);
  });

  it.fails("BUG-18b: delay time should be read little-endian per the GIF spec", () => {
    // dv.getUint16(offset + 4) defaults to big-endian while GIF stores the
    // delay little-endian. The boolean survives — any non-zero delay has a
    // non-zero byte either way — but the value read is byte-swapped.
    const gif = makeGif({ delay: 10 });
    const gceOffset = gif.indexOf(Buffer.from([0x21, 0xf9]));
    const ab = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength) as ArrayBuffer;
    const dv = new DataView(ab);

    expect(dv.getUint16(gceOffset + 4)).toBe(10);
  });
});
