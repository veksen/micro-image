import { describe, it, expect } from "vitest";
import { gifDelayTime, isAnimatedGif } from "./is-animated-gif";
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
 * BUG-18 was materially worse than "theoretically possible". The probe ran on
 * every supported mime with no `contentType === "image/gif"` guard, and matched
 * the extension bytes with bitwise AND rather than equality, so it passed on any
 * byte pair sharing a single bit with the masks. For a JPEG, byte 10 — where the
 * function expects the GIF logical screen descriptor — is the first
 * quantization-table entry, whose value is set by encoder quality:
 *
 *   quality  byte10  intro  label  => detected as animated gif
 *   50       0x0e    0x10   0x0e   no
 *   60       0x0b    0x0d   0x0b   YES  (delay read as 3598)
 *   75       0x07    0x08   0x07   no
 *   80       0x06    0x06   0x06   no
 *   90       0x03    0x03   0x03   YES  (delay read as 1027)
 *   100      0x01    0x01   0x01   YES  (delay read as 257)
 *
 * A false positive meant the route returned the ORIGINAL bytes uncompressed and
 * unresized, and cached that. The regressions below pin the fix.
 */
describe("isAnimatedGif — non-gif input [BUG-18]", () => {
  it("rejects png", async () => {
    expect(isAnimatedGif(await makePng({ width: 64, height: 64 }))).toBe(false);
  });

  it("rejects bytes that are not an image at all", () => {
    expect(isAnimatedGif(Buffer.from("not an image at all"))).toBe(false);
  });

  it("rejects an empty or truncated buffer instead of reading past the end", () => {
    expect(isAnimatedGif(Buffer.alloc(0))).toBe(false);
    expect(isAnimatedGif(Buffer.from("GIF89a", "ascii"))).toBe(false);
    expect(isAnimatedGif(makeGif({ delay: 10 }).subarray(0, 20))).toBe(false);
  });
});

describe("bug ledger", () => {
  it("BUG-18: a jpeg should never be reported as an animated gif", async () => {
    const jpeg = await makeJpeg({ width: 64, height: 64, quality: 100 });
    expect(isAnimatedGif(jpeg)).toBe(false);
  });

  it("BUG-18: no jpeg quality should be reported as an animated gif", async () => {
    const detected: number[] = [];

    for (const quality of [50, 60, 70, 75, 80, 85, 90, 95, 100]) {
      const jpeg = await makeJpeg({ width: 64, height: 64, quality });
      if (isAnimatedGif(jpeg)) detected.push(quality);
    }

    expect(detected).toEqual([]);
  });

  it("BUG-18: extension bytes should be matched by equality, not bitwise AND", () => {
    // 0x20/0xf8 are not GCE markers, but each shares a bit with the masks
    const gif = makeGif({ delay: 10 });
    const gceOffset = gif.indexOf(Buffer.from([0x21, 0xf9]));
    expect(gceOffset).toBeGreaterThan(-1);

    gif.writeUInt8(0x20, gceOffset);
    gif.writeUInt8(0xf8, gceOffset + 1);

    expect(isAnimatedGif(gif)).toBe(false);
  });

  /**
   * Rewritten, not merely flipped. The original ledger test built its own
   * DataView over the fixture and asserted `dv.getUint16(gceOffset + 4) === 10`
   * — an assertion about DataView's default endianness and the fixture, which
   * never called the module under test. It could not have flipped no matter
   * what the source did.
   *
   * Endianness is not observable through a boolean: a delay is non-zero either
   * way round. So the decoded value is exported and asserted directly. 256 is
   * the discriminating case — stored little-endian it is 0x00 0x01, which a
   * big-endian read returns as 1.
   */
  it("BUG-18b: delay time should be read little-endian per the GIF spec", () => {
    expect(gifDelayTime(makeGif({ delay: 10 }))).toBe(10);
    expect(gifDelayTime(makeGif({ delay: 256 }))).toBe(256);
  });

  it("BUG-18b: a buffer with no delay to read reports no delay", () => {
    expect(gifDelayTime(makeGif({ delay: 0 }))).toBe(0);
    expect(gifDelayTime(makeGif({ graphicsControlExtension: false }))).toBeNull();
    expect(gifDelayTime(Buffer.from("not an image at all"))).toBeNull();
  });
});
