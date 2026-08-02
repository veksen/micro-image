import { describe, it, expect } from "vitest";
import { frameCount, isAnimated } from "./is-animated";
import {
  insertPngChunkBeforeIdat,
  makeApng,
  makeJpeg,
  makeLoopingGif,
  makeAnimatedWebp,
  makePng,
  makeSharpAnimatedGif,
  makeWebp,
  pngChunk,
  pngChunkTypes,
} from "./test-helpers";

describe("frameCount", () => {
  it("counts the frames in an animated gif", async () => {
    expect(await frameCount(await makeSharpAnimatedGif({ frames: 5 }))).toBe(5);
    expect(await frameCount(await makeSharpAnimatedGif({ frames: 12 }))).toBe(12);
  });

  it("counts the frames in an animated webp", async () => {
    expect(await frameCount(await makeAnimatedWebp({ frames: 5 }))).toBe(5);
  });

  it("reports one frame for a still image, whatever the format", async () => {
    expect(await frameCount(await makeJpeg())).toBe(1);
    expect(await frameCount(await makePng())).toBe(1);
    expect(await frameCount(await makeWebp())).toBe(1);
    expect(await frameCount(await makeSharpAnimatedGif({ frames: 1 }))).toBe(1);
  });

  it("reports null for bytes no decoder will accept", async () => {
    expect(await frameCount(Buffer.from("not an image at all"))).toBeNull();
    expect(await frameCount(Buffer.alloc(0))).toBeNull();
    expect(await frameCount(Buffer.from("GIF89a", "ascii"))).toBeNull();
  });
});

describe("isAnimated", () => {
  it("detects an animated gif", async () => {
    expect(await isAnimated(await makeSharpAnimatedGif({ frames: 5 }))).toBe(true);
  });

  it("detects an animated webp", async () => {
    expect(await isAnimated(await makeAnimatedWebp({ frames: 5 }))).toBe(true);
  });

  it("does not treat a still image as animated", async () => {
    expect(await isAnimated(await makeJpeg())).toBe(false);
    expect(await isAnimated(await makePng())).toBe(false);
    expect(await isAnimated(await makeWebp())).toBe(false);
    expect(await isAnimated(await makeSharpAnimatedGif({ frames: 1 }))).toBe(false);
  });

  it("does not treat undecodable bytes as animated", async () => {
    expect(await isAnimated(Buffer.from("not an image at all"))).toBe(false);
    expect(await isAnimated(Buffer.alloc(0))).toBe(false);
    // A well-formed animated header over truncated frame data. The old probe
    // read only the front of the container and would have called this animated;
    // libvips rejects the payload, and a payload nothing can decode is not an
    // animation.
    expect(await isAnimated(makeLoopingGif({ frames: 3 }).subarray(0, 40))).toBe(false);
  });
});

/**
 * The reason this module exists.
 *
 * `gifDelayTime` located the first Graphics Control Extension at
 * `6 + 7 + globalColorTableSize` and required `0x21 0xF9` there. Every looping
 * GIF puts a NETSCAPE 2.0 Application Extension (`0x21 0xFF`) at exactly that
 * offset — that block is how looping is signalled — and the first real GCE sits
 * 19 bytes later. Measured on a 30-frame 800x600 GIF: probe offset 781 held
 * `0x21 0xff` followed by ASCII `NETSCAPE2.0`, the real GCE was at 800, and the
 * route returned 1 frame of the 30 it was given.
 *
 * The fixture below is encoded by hand rather than by sharp, so the assertion
 * does not rest on libvips agreeing with itself about a file libvips wrote.
 */
describe("looping gifs — the NETSCAPE application extension [#52]", () => {
  it("detects a looping gif whose first extension block is NETSCAPE 2.0", async () => {
    const gif = makeLoopingGif({ frames: 3 });

    expect(await frameCount(gif)).toBe(3);
    expect(await isAnimated(gif)).toBe(true);
  });

  it("is unmoved by where the application extension puts the first GCE", async () => {
    const gif = makeLoopingGif({ frames: 3 });

    // the offset the old fixed-offset probe read: header + LSD + 4-entry table
    const probeOffset = 6 + 7 + 12;
    expect([...gif.subarray(probeOffset, probeOffset + 2)]).toEqual([0x21, 0xff]);
    expect(gif.indexOf(Buffer.from([0x21, 0xf9]))).toBeGreaterThan(probeOffset);

    expect(await isAnimated(gif)).toBe(true);
  });

  it("detects a looping gif whatever its frame delay", async () => {
    // A still-frame delay of 0 is legal and common in GIFs assembled by hand.
    // The retired probe keyed on `delay > 0`, so it called those stills.
    expect(await isAnimated(makeLoopingGif({ frames: 4, delay: 0 }))).toBe(true);
    expect(await isAnimated(makeLoopingGif({ frames: 4, delay: 100 }))).toBe(true);
  });

  it("does not treat a single-frame looping gif as animated", async () => {
    expect(await frameCount(makeLoopingGif({ frames: 1 }))).toBe(1);
    expect(await isAnimated(makeLoopingGif({ frames: 1 }))).toBe(false);
  });
});

/**
 * APNG is the one animated format libvips cannot see (#53).
 *
 * Every other container answers `metadata().pages`. PNG does not: libvips has no
 * APNG code in either direction, so it reports no page count at all rather than
 * reporting the wrong one. Asking the decoder — the principle this module is
 * built on — returns 1 for a 12-frame file, and the transform then throws 11
 * frames away without an error or a warning event.
 *
 * So this is the one case that must read the container. `acTL` before the first
 * `IDAT` is the signal, per PNG Third Edition §11.3.6.1.
 */
describe("apng — the format libvips cannot page [#53]", () => {
  it("counts the frames an acTL declares", async () => {
    expect(await frameCount(makeApng({ frames: 12 }))).toBe(12);
    expect(await frameCount(makeApng({ frames: 2 }))).toBe(2);
  });

  it("detects an apng as animated", async () => {
    expect(await isAnimated(makeApng({ frames: 12 }))).toBe(true);
  });

  it("does not treat a still png from the same builder as animated", async () => {
    // identical construction, chunk layout and pixel data — only the acTL differs
    const still = makeApng({ frames: 12, animationControl: false });

    expect(await frameCount(still)).toBe(1);
    expect(await isAnimated(still)).toBe(false);
  });

  it("does not treat a single-frame apng as animated", async () => {
    expect(await frameCount(makeApng({ frames: 1 }))).toBe(1);
    expect(await isAnimated(makeApng({ frames: 1 }))).toBe(false);
  });

  it("reads the count from the container, not from sharp", async () => {
    const apng = makeApng({ frames: 12 });
    const sharp = (await import("sharp")).default;

    // the gap this closes: sharp decodes the file happily and still says nothing
    // about the other 11 frames
    const metadata = await sharp(apng).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.pages).toBeUndefined();

    expect(await frameCount(apng)).toBe(12);
  });

  it("ignores a well-formed acTL that arrives after the first IDAT", async () => {
    // §11.3.6.1: "The acTL chunk must appear before the first IDAT chunk within
    // a valid PNG stream." A late one animates nothing, and honouring it would
    // pass through files that should have been transformed.
    const still = makeApng({ frames: 12, animationControl: false });
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(12, 0); // num_frames
    actl.writeUInt32BE(0, 4); // num_plays

    // between the last IDAT and IEND, so the walk would reach it if it kept going
    const iendStart = still.length - 12;
    const late = Buffer.concat([
      still.subarray(0, iendStart),
      pngChunk("acTL", actl),
      still.subarray(iendStart),
    ]);

    expect(pngChunkTypes(late)).toEqual(["IHDR", "IDAT", "acTL", "IEND"]);
    expect(await isAnimated(late)).toBe(false);
  });

  it("is not fooled by the acTL bytes sitting inside another chunk's data", async () => {
    // The four bytes are only a chunk type when a length prefix puts them there.
    // This plants them before the first IDAT, inside a valid tEXt chunk, which
    // is exactly where a scan-for-bytes probe would find them and be wrong.
    const still = makeApng({ frames: 12, animationControl: false });
    const decoy = pngChunk("tEXt", Buffer.from("Comment\0acTL twelve frames", "ascii"));
    const planted = insertPngChunkBeforeIdat(still, decoy);

    const bytesAt = planted.indexOf(Buffer.from("acTL", "ascii"));
    const idatAt = planted.indexOf(Buffer.from("IDAT", "ascii"));
    expect(bytesAt).toBeGreaterThan(0);
    expect(bytesAt).toBeLessThan(idatAt);
    expect(pngChunkTypes(planted)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);

    expect(await isAnimated(planted)).toBe(false);
  });

  it("refuses to read a frame count out of a truncated acTL", async () => {
    // A zero-length acTL would otherwise hand back whatever four bytes follow —
    // its own CRC, or the next chunk's length prefix — as a frame count.
    const still = makeApng({ frames: 12, animationControl: false });
    const empty = insertPngChunkBeforeIdat(still, pngChunk("acTL", Buffer.alloc(0)));

    expect(pngChunkTypes(empty)).toEqual(["IHDR", "acTL", "IDAT", "IEND"]);
    expect(await frameCount(empty)).toBe(1);
    expect(await isAnimated(empty)).toBe(false);
  });
});

/**
 * BUG-18 was the mirror image of #52: a false positive where this is a false
 * negative. The retired probe ran on every supported mime and matched the
 * extension bytes with bitwise AND rather than equality, so it passed on any
 * byte pair sharing a single bit with the masks. For a JPEG, byte 10 — where it
 * expected the GIF logical screen descriptor — is the first quantization-table
 * entry, whose value is set by encoder quality:
 *
 *   quality  byte10  intro  label  => detected as animated gif
 *   50       0x0e    0x10   0x0e   no
 *   60       0x0b    0x0d   0x0b   YES  (delay read as 3598)
 *   75       0x07    0x08   0x07   no
 *   90       0x03    0x03   0x03   YES  (delay read as 1027)
 *   100      0x01    0x01   0x01   YES  (delay read as 257)
 *
 * A false positive meant the route returned the ORIGINAL bytes uncompressed and
 * unresized, and cached that.
 *
 * These are the BUG-18 ledger tests, carried over to the replacement rather than
 * deleted with the module they were written against. They still describe the
 * behaviour that must not come back; only the probe underneath them changed.
 */
describe("bug ledger", () => {
  it("BUG-18: a jpeg should never be reported as animated", async () => {
    expect(await isAnimated(await makeJpeg({ width: 64, height: 64, quality: 100 }))).toBe(false);
  });

  it("BUG-18: no jpeg quality should be reported as animated", async () => {
    const detected: number[] = [];

    for (const quality of [50, 60, 70, 75, 80, 85, 90, 95, 100]) {
      const jpeg = await makeJpeg({ width: 64, height: 64, quality });
      if (await isAnimated(jpeg)) detected.push(quality);
    }

    expect(detected).toEqual([]);
  });

  /**
   * The original read `0x21 0xF9` at a computed offset and decoded a 16-bit
   * delay behind it, so it could be fooled by any format whose bytes happened to
   * land that way. There is nothing left to fool: the frame count comes from the
   * decoder that already knows what format it is holding. This asserts the
   * property that made both bugs possible is gone — the answer now depends on
   * the format, not on what sits at a fixed offset.
   */
  it("BUG-18: animation should be decided by the decoder, not by a byte offset", async () => {
    const jpeg = await makeJpeg({ width: 64, height: 64, quality: 100 });

    // plant the exact byte pair the retired probe looked for, at the exact
    // offset it looked at, with a non-zero little-endian delay behind it
    const planted = Buffer.from(jpeg);
    const gceOffset = 6 + 7;
    planted.writeUInt8(0x21, gceOffset);
    planted.writeUInt8(0xf9, gceOffset + 1);
    planted.writeUInt16LE(10, gceOffset + 4);

    expect(await isAnimated(planted)).toBe(false);
  });

  /**
   * BUG-18b was about endianness: the delay is stored little-endian, and reading
   * it big-endian turned 256 into 1. Endianness is not observable through a
   * boolean, so `gifDelayTime` was exported and asserted directly.
   *
   * No integer is read out of the container any more, so there is no byte order
   * left to get wrong. What survives is the reason the value was exported at
   * all: the number has to stay observable, because a boolean cannot tell a
   * correct count from a wrong one. `frameCount` is that number, and it is
   * asserted against fixtures whose frame count is known by construction.
   */
  it("BUG-18b: the frame count should be observable, not just its truthiness", async () => {
    expect(await frameCount(await makeSharpAnimatedGif({ frames: 2 }))).toBe(2);
    expect(await frameCount(await makeSharpAnimatedGif({ frames: 7 }))).toBe(7);
    expect(await frameCount(makeLoopingGif({ frames: 5 }))).toBe(5);
    expect(await frameCount(await makeAnimatedWebp({ frames: 3 }))).toBe(3);
  });
});
