import http from "http";
import zlib from "zlib";
import type { AddressInfo } from "net";
import sharp from "sharp";

/**
 * Deterministic image fixtures. Generated at runtime with sharp rather than
 * committed as binaries, so the repo stays text-only and fixtures can't drift
 * from the sharp version actually installed.
 */

export interface MakeImageOptions {
  width?: number;
  height?: number;
  /** "noise" produces incompressible content; "flat" compresses very well. */
  content?: "flat" | "noise" | "gradient";
  /** JPEG/WebP encoder quality. Changes the bytes, not the picture. */
  quality?: number;
}

function rawPixels({ width = 64, height = 64, content = "gradient" }: MakeImageOptions) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (content === "flat") {
        data[i] = 200;
        data[i + 1] = 40;
        data[i + 2] = 40;
      } else if (content === "gradient") {
        data[i] = Math.floor((x / width) * 255);
        data[i + 1] = Math.floor((y / height) * 255);
        data[i + 2] = 128;
      } else {
        // deterministic pseudo-noise (no Math.random, so fixtures are stable)
        const n = (x * 7919 + y * 104729) % 255;
        data[i] = n;
        data[i + 1] = (n * 31) % 255;
        data[i + 2] = (n * 17) % 255;
      }
    }
  }

  return { data, width, height, channels: channels as 3 };
}

export function makeJpeg(options: MakeImageOptions = {}): Promise<Buffer> {
  const { data, width, height, channels } = rawPixels(options);
  return sharp(data, { raw: { width, height, channels } })
    .jpeg({ quality: options.quality ?? 100 })
    .toBuffer();
}

export function makePng(options: MakeImageOptions = {}): Promise<Buffer> {
  const { data, width, height, channels } = rawPixels(options);
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

export function makeWebp(options: MakeImageOptions = {}): Promise<Buffer> {
  const { data, width, height, channels } = rawPixels(options);
  return sharp(data, { raw: { width, height, channels } })
    .webp({ quality: options.quality ?? 80 })
    .toBuffer();
}

export interface MakeAnimatedOptions extends MakeImageOptions {
  /** Number of frames. Must be at least 2 for the result to be animated. */
  frames?: number;
  /** Per-frame delay in milliseconds. */
  delayMs?: number;
}

/**
 * A filmstrip: every frame stacked vertically in one raw image, with
 * `raw.pageHeight` telling libvips where each one ends. This is how sharp
 * represents an animation — one image of `width x (pageHeight * pages)`.
 */
function animatedStrip({ width = 32, height = 32, frames = 5 }: MakeAnimatedOptions) {
  const channels = 3;
  const data = Buffer.alloc(width * height * frames * channels);

  for (let frame = 0; frame < frames; frame++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = ((frame * height + y) * width + x) * channels;
        // the frame index drives red, so no two frames are byte-identical and
        // an encoder cannot collapse them into one
        data[i] = (frame * 47) % 256;
        data[i + 1] = Math.floor((x / width) * 255);
        data[i + 2] = Math.floor((y / height) * 255);
      }
    }
  }

  return sharp(data, { raw: { width, height: height * frames, channels: 3, pageHeight: height } });
}

/** A real multi-frame WebP, written by libwebp via sharp. */
export function makeAnimatedWebp(options: MakeAnimatedOptions = {}): Promise<Buffer> {
  return animatedStrip(options)
    .webp({ quality: options.quality ?? 80, delay: options.delayMs ?? 100, loop: 0 })
    .toBuffer();
}

/** A real multi-frame GIF, written by cgif via sharp. */
export function makeSharpAnimatedGif(options: MakeAnimatedOptions = {}): Promise<Buffer> {
  return animatedStrip(options)
    .gif({ delay: options.delayMs ?? 100, loop: 0 })
    .toBuffer();
}

/**
 * Packs codes LSB-first, which is the bit order GIF's LZW stream uses
 * (GIF89a spec, Appendix F).
 */
class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private bitsUsed = 0;

  write(code: number, codeWidth: number): void {
    for (let bit = 0; bit < codeWidth; bit++) {
      if (code & (1 << bit)) {
        this.current |= 1 << this.bitsUsed;
      }

      if (++this.bitsUsed === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.bitsUsed = 0;
      }
    }
  }

  finish(): Buffer {
    if (this.bitsUsed > 0) {
      this.bytes.push(this.current);
    }

    return Buffer.from(this.bytes);
  }
}

/**
 * A valid but deliberately naive LZW stream: a Clear Code before every literal,
 * so the decoder's table never grows and the code width never changes.
 *
 * Real encoders compress. This one only has to produce bytes any GIF decoder
 * accepts, and staying at a fixed code width removes the only part of LZW that
 * is easy to get subtly wrong.
 */
function gifLzwLiterals(indices: number[], minCodeSize: number): Buffer {
  const clearCode = 1 << minCodeSize;
  const endOfInformation = clearCode + 1;
  const codeWidth = minCodeSize + 1;

  const writer = new BitWriter();
  for (const index of indices) {
    writer.write(clearCode, codeWidth);
    writer.write(index, codeWidth);
  }
  writer.write(clearCode, codeWidth);
  writer.write(endOfInformation, codeWidth);

  // Image data travels in sub-blocks of at most 255 bytes, each prefixed with
  // its length and the run terminated by a zero-length block.
  const stream = writer.finish();
  const blocks: Buffer[] = [Buffer.from([minCodeSize])];
  for (let offset = 0; offset < stream.length; offset += 255) {
    const chunk = stream.subarray(offset, offset + 255);
    blocks.push(Buffer.from([chunk.length]), chunk);
  }
  blocks.push(Buffer.from([0x00]));

  return Buffer.concat(blocks);
}

export interface MakeLoopingGifOptions {
  /** Number of frames written. */
  frames?: number;
  /** Square edge length in pixels. */
  size?: number;
  /** Delay per frame in 1/100s, little-endian per the spec. */
  delay?: number;
  /** NETSCAPE loop count; 0 means forever. */
  loop?: number;
}

/**
 * A genuine looping animated GIF, encoded here rather than by sharp.
 *
 * This exists because every other GIF in the suite comes from libvips/cgif —
 * the same library the code under test asks about animation — so an agreement
 * between them proves nothing about a GIF from anywhere else. The block layout
 * is the one the GIF89a spec prescribes and that GIMP, ImageMagick and
 * `gifsicle` all emit: a NETSCAPE 2.0 Application Extension announcing the loop
 * immediately after the Global Colour Table, and only then the first Graphics
 * Control Extension.
 *
 * That ordering is the whole bug. A probe that expects `0x21 0xF9` right after
 * the colour table finds `0x21 0xFF` — the Application Extension — and reports
 * a 30-frame animation as a still image.
 */
export function makeLoopingGif(options: MakeLoopingGifOptions = {}): Buffer {
  const { frames = 3, size = 4, delay = 10, loop = 0 } = options;

  // 4 colours, so N = 1 in the packed field and the table is 3 * 2^2 bytes.
  const colorTableSizeExponent = 1;
  const minCodeSize = 2;

  const parts: Buffer[] = [];

  parts.push(Buffer.from("GIF89a", "ascii"));

  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(size, 0); // logical screen width
  lsd.writeUInt16LE(size, 2); // logical screen height
  lsd.writeUInt8(0x80 | colorTableSizeExponent, 4); // global colour table present
  lsd.writeUInt8(0, 5); // background colour index
  lsd.writeUInt8(0, 6); // pixel aspect ratio
  parts.push(lsd);

  // Global Colour Table: black, red, green, blue.
  parts.push(Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]));

  // NETSCAPE 2.0 Application Extension — the looping signal, and the block that
  // sits where a fixed-offset probe expects the first Graphics Control
  // Extension.
  const netscape = Buffer.alloc(19);
  netscape.writeUInt8(0x21, 0); // extension introducer
  netscape.writeUInt8(0xff, 1); // application extension label
  netscape.writeUInt8(0x0b, 2); // block size: 11 bytes of identifier
  netscape.write("NETSCAPE2.0", 3, "ascii");
  netscape.writeUInt8(0x03, 14); // sub-block size
  netscape.writeUInt8(0x01, 15); // sub-block id: loop count follows
  netscape.writeUInt16LE(loop, 16);
  netscape.writeUInt8(0x00, 18); // block terminator
  parts.push(netscape);

  for (let frame = 0; frame < frames; frame++) {
    const gce = Buffer.alloc(8);
    gce.writeUInt8(0x21, 0); // extension introducer
    gce.writeUInt8(0xf9, 1); // graphics control label
    gce.writeUInt8(0x04, 2); // block size
    gce.writeUInt8(0x00, 3); // packed
    gce.writeUInt16LE(delay, 4); // delay time, little-endian per spec
    gce.writeUInt8(0x00, 6); // transparent colour index
    gce.writeUInt8(0x00, 7); // block terminator
    parts.push(gce);

    const imageDescriptor = Buffer.alloc(10);
    imageDescriptor.writeUInt8(0x2c, 0); // image separator
    imageDescriptor.writeUInt16LE(0, 1); // left
    imageDescriptor.writeUInt16LE(0, 3); // top
    imageDescriptor.writeUInt16LE(size, 5); // width
    imageDescriptor.writeUInt16LE(size, 7); // height
    imageDescriptor.writeUInt8(0x00, 9); // no local colour table, not interlaced
    parts.push(imageDescriptor);

    // Rotate the palette per frame so no two frames are identical.
    const pixels = Array.from({ length: size * size }, (_, i) => (i + frame) % 4);
    parts.push(gifLzwLiterals(pixels, minCodeSize));
  }

  parts.push(Buffer.from([0x3b])); // trailer

  return Buffer.concat(parts);
}

export interface MakeApngOptions {
  /** Number of frames. Must be at least 2 for the result to be animated. */
  frames?: number;
  /** Square edge length in pixels. */
  size?: number;
  /** Frame delay numerator, in `delayDen`ths of a second. */
  delayNum?: number;
  /** Frame delay denominator. The spec reads 0 as 100. */
  delayDen?: number;
  /**
   * Emit the `acTL` chunk. Off produces a still PNG from the same builder, so a
   * test can vary animation alone and hold every other byte pattern constant.
   */
  animationControl?: boolean;
}

/**
 * One PNG chunk: length, type, data, CRC-32 over type and data.
 *
 * `zlib.crc32` is Node's own (>= 22.2), so the CRCs are not a reimplementation
 * that could agree with a matching mistake in the reader.
 *
 * Exported so a test can plant a *well-formed* chunk rather than splicing loose
 * bytes into a file. Splicing shifts every chunk after the cut and corrupts the
 * length prefixes, which makes the resulting fixture prove nothing about how a
 * reader handles a chunk in that position.
 */
export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
}

/** Truecolour scanlines, each prefixed with filter type 0 (None), deflated. */
function pngImageData(size: number, frame: number): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 3));
  let offset = 0;

  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      // the frame index drives red, so no two frames are byte-identical
      raw[offset++] = (frame * 47) % 256;
      raw[offset++] = Math.floor((x / size) * 255);
      raw[offset++] = Math.floor((y / size) * 255);
    }
  }

  return zlib.deflateSync(raw);
}

/**
 * A real APNG, assembled here because nothing in the toolchain can write one.
 *
 * sharp cannot: a filmstrip with `raw.pageHeight` set, whose metadata reports
 * `pages` before encoding, comes out of `png()` as a single tall stack with zero
 * `acTL` chunks. libvips has no APNG code in either direction — `vipspng.c`,
 * `pngload.c` and `spngload.c` at v8.18.3 contain no reference to it — which is
 * also why the proxy cannot resize one and has to pass it through.
 *
 * Chunk order is the one PNG Third Edition prescribes:
 * `IHDR acTL fcTL IDAT (fcTL fdAT)*n IEND`. The single `fcTL` before `IDAT` is
 * what makes the static image serve as frame 0 (§11.3.6.1); without it the
 * static image is not part of the animation at all. Sequence numbers run
 * unbroken across every `fcTL` and `fdAT`, which the spec requires.
 */
export function makeApng(options: MakeApngOptions = {}): Buffer {
  const { frames = 12, size = 8, delayNum = 1, delayDen = 10, animationControl = true } = options;

  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2: truecolour
  ihdr.writeUInt8(0, 10); // compression: deflate
  ihdr.writeUInt8(0, 11); // filter: adaptive
  ihdr.writeUInt8(0, 12); // interlace: none
  parts.push(pngChunk("IHDR", ihdr));

  // The acTL must precede the first IDAT (PNG 3rd ed §11.3.6.1). That ordering
  // is the whole detection signal.
  if (animationControl) {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(frames, 0); // num_frames
    actl.writeUInt32BE(0, 4); // num_plays: 0 loops forever
    parts.push(pngChunk("acTL", actl));
  }

  let sequence = 0;

  const frameControl = () => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0); // sequence_number
    fctl.writeUInt32BE(size, 4); // width
    fctl.writeUInt32BE(size, 8); // height
    fctl.writeUInt32BE(0, 12); // x_offset
    fctl.writeUInt32BE(0, 16); // y_offset
    fctl.writeUInt16BE(delayNum, 20);
    fctl.writeUInt16BE(delayDen, 22);
    fctl.writeUInt8(0, 24); // dispose_op: NONE
    fctl.writeUInt8(0, 25); // blend_op: SOURCE
    return pngChunk("fcTL", fctl);
  };

  if (animationControl) {
    parts.push(frameControl());
  }
  parts.push(pngChunk("IDAT", pngImageData(size, 0)));

  if (animationControl) {
    for (let frame = 1; frame < frames; frame++) {
      parts.push(frameControl());

      // fdAT carries the same deflated scanlines as IDAT, behind a sequence number
      const sequenceNumber = Buffer.alloc(4);
      sequenceNumber.writeUInt32BE(sequence++, 0);
      parts.push(pngChunk("fdAT", Buffer.concat([sequenceNumber, pngImageData(size, frame)])));
    }
  }

  parts.push(pngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(parts);
}

/**
 * Every chunk type in a PNG, in file order.
 *
 * Walks the length prefixes rather than searching for the four type bytes. A
 * search would count a `fdAT` that happens to occur inside deflated pixel data,
 * so it could report an animation surviving when it had not — the assertion
 * failing open, which is the worst way for a test about lost frames to be wrong.
 */
export function pngChunkTypes(buffer: Buffer): string[] {
  const types: string[] = [];
  let offset = 8; // past the signature

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    types.push(buffer.toString("ascii", offset + 4, offset + 8));
    offset += 12 + length;
  }

  return types;
}

/**
 * Splices a well-formed chunk in immediately before the first `IDAT`.
 *
 * Everything downstream keeps its own valid length prefix, so the result is a
 * file a conforming reader would still parse — which is what makes it a fair
 * test of where a reader looks rather than of how it copes with damage.
 */
export function insertPngChunkBeforeIdat(png: Buffer, chunk: Buffer): Buffer {
  // back up 4 bytes from the type to the chunk's own length field
  const idatStart = png.indexOf(Buffer.from("IDAT", "ascii")) - 4;

  return Buffer.concat([png.subarray(0, idatStart), chunk, png.subarray(idatStart)]);
}

/**
 * A real local HTTP origin. Using a real socket rather than mocking axios keeps
 * the proxy's actual network path (agents, headers, arraybuffer decoding) under
 * test.
 */
export interface OriginRoute {
  body: Buffer | string;
  contentType?: string | null;
  status?: number;
  /** Omit content-length and stream the body chunked. */
  chunked?: boolean;
  /** Artificial delay before responding, in ms. */
  delayMs?: number;
}

export interface Origin {
  url: string;
  /** How many times each path has been requested. */
  hits: Record<string, number>;
  totalHits: () => number;
  close: () => Promise<void>;
}

export async function startOrigin(routes: Record<string, OriginRoute>): Promise<Origin> {
  const hits: Record<string, number> = {};

  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0] as string;
    hits[path] = (hits[path] || 0) + 1;

    const route = routes[path];
    if (!route) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const send = () => {
      res.statusCode = route.status ?? 200;
      if (route.contentType !== null) {
        res.setHeader("content-type", route.contentType ?? "image/jpeg");
      }

      const body = Buffer.isBuffer(route.body) ? route.body : Buffer.from(route.body);

      if (route.chunked) {
        // no content-length: forces chunked transfer encoding
        res.write(body.subarray(0, Math.ceil(body.length / 2)));
        res.end(body.subarray(Math.ceil(body.length / 2)));
      } else {
        res.setHeader("content-length", String(body.length));
        res.end(body);
      }
    };

    if (route.delayMs) {
      setTimeout(send, route.delayMs);
    } else {
      send();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    totalHits: () => Object.values(hits).reduce((a, b) => a + b, 0),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
