import http from "http";
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

/**
 * Hand-built GIF bytes. `isAnimatedGif` parses the container directly, so
 * constructing the container by hand is the only way to control exactly the
 * bytes it reads (global colour table presence, delay time, extension bytes).
 */
export interface MakeGifOptions {
  /** Delay time in 1/100s, stored little-endian per the GIF spec. 0 = static. */
  delay?: number;
  /** Whether to emit a Global Color Table. */
  globalColorTable?: boolean;
  /** N in the packed field; table size is 3 * 2^(N+1) bytes. */
  colorTableSizeExponent?: number;
  /** Emit the Graphics Control Extension block at all. */
  graphicsControlExtension?: boolean;
}

export function makeGif(options: MakeGifOptions = {}): Buffer {
  const {
    delay = 0,
    globalColorTable = true,
    colorTableSizeExponent = 1,
    graphicsControlExtension = true,
  } = options;

  const parts: Buffer[] = [];

  // Header (6 bytes)
  parts.push(Buffer.from("GIF89a", "ascii"));

  // Logical Screen Descriptor (7 bytes)
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(4, 0); // width
  lsd.writeUInt16LE(4, 2); // height
  lsd.writeUInt8(globalColorTable ? 0x80 | colorTableSizeExponent : 0x00, 4); // packed
  lsd.writeUInt8(0, 5); // background colour index
  lsd.writeUInt8(0, 6); // pixel aspect ratio
  parts.push(lsd);

  // Global Color Table: 3 * 2^(N+1) bytes
  if (globalColorTable) {
    parts.push(Buffer.alloc(3 * 2 ** (colorTableSizeExponent + 1)));
  }

  // Graphics Control Extension (8 bytes)
  if (graphicsControlExtension) {
    const gce = Buffer.alloc(8);
    gce.writeUInt8(0x21, 0); // extension introducer
    gce.writeUInt8(0xf9, 1); // graphics control label
    gce.writeUInt8(0x04, 2); // block size
    gce.writeUInt8(0x00, 3); // packed
    gce.writeUInt16LE(delay, 4); // delay time, little-endian per spec
    gce.writeUInt8(0, 6); // transparent colour index
    gce.writeUInt8(0, 7); // block terminator
    parts.push(gce);
  }

  // Trailer + padding so DataView reads never run off the end
  parts.push(Buffer.alloc(32));
  parts.push(Buffer.from([0x3b]));

  return Buffer.concat(parts);
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
