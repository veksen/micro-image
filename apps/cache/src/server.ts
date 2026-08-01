import http from "http";
import https from "https";
import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";
import { buildId, fromCache, toCache } from "./cache";
import { isAnimatedGif } from "./is-animated-gif";
import { coalesce } from "./coalesce";

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

export interface CacheQuerystring {
  image: string;
  width?: string;
  quality?: string;
  format?: string;
  blur?: string;
}

export type CacheRequest = FastifyRequest<{ Querystring: CacheQuerystring }>;

/**
 * The radius the proxy has always applied when a client asked for `blur=true`.
 * The published client still sends the boolean, so the parser maps it onto the
 * historical radius rather than inventing a new default.
 */
export const legacyBlurRadius = 10;

/** A parsed, normalised query string. */
export interface CacheOptions {
  width?: number;
  quality?: number;
  format?: string;
  blur?: number;
}

/** Anything unusable becomes undefined, which `buildId` omits. */
function positiveNumber(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parses the query string once, so the cache key and the transform cannot
 * disagree about what was asked for. That disagreement was the actual defect
 * behind BUG-17: `buildId` includes any key handed to it, and the route only
 * ever handed it two.
 */
export function parseCacheOptions(query: CacheQuerystring): CacheOptions {
  return {
    width: positiveNumber(query.width),
    quality: positiveNumber(query.quality),
    format: query.format || undefined,
    blur: query.blur === "true" ? legacyBlurRadius : positiveNumber(query.blur),
  };
}

export interface CompressOptions {
  contentType?: string;
  width?: number;
  blur?: boolean;
  quality?: number;
}

export const gifMime = "image/gif";

export const supportedMimes = ["image/png", "image/webp", gifMime, "image/jpg", "image/jpeg"];

export const cacheControl =
  "public, max-age=2592000, stale-while-revalidate=60, stale-if-error=43200, immutable";

export function isSupported(mime: string): boolean {
  return supportedMimes.includes(mime);
}

export function imageFromMime(image: sharp.Sharp, mime?: string, quality?: number): sharp.Sharp {
  switch (mime) {
    case "image/png":
      return image.png();
    case "image/webp":
      return image.webp();
    case "image/gif":
      return image.gif();
    case "image/jpg":
    case "image/jpeg":
    default:
      return image.jpeg({ mozjpeg: true, quality: quality || 75 });
  }
}

export function compress(buffer: Buffer, options: CompressOptions): Promise<Buffer> {
  // TODO: support webp, double check against animated png
  let sharpImage = sharp(buffer);

  if (options.width) {
    sharpImage = sharpImage.resize({ width: options.width || 1000, withoutEnlargement: true });
  }

  if (options.blur) {
    sharpImage = sharpImage.blur(10);
  }

  const image = imageFromMime(sharpImage, options.contentType, options.quality);

  return image.toBuffer();
}

export function getSmallestImage(image1: Buffer, image2: Buffer): Buffer {
  return image1.byteLength < image2.byteLength ? image1 : image2;
}

export async function downloadImage(url: string) {
  return axios(url, {
    responseType: "arraybuffer",
    httpAgent,
    httpsAgent,
  });
}

export interface BuildServerOptions {
  logger?: boolean;
}

/**
 * Builds the Fastify instance without listening, so it can be driven by
 * `fastify.inject()` in tests.
 *
 * NOTE: this is a straight extraction of the previous top-level route code.
 * Behaviour is intentionally unchanged, including the known bugs the test
 * suite documents (see BUGS.md).
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const fastify = Fastify({
    logger: options.logger ?? true,
  });

  fastify.get("/", async (request, reply) => {
    reply.type("application/json").code(200);
    return { hello: "world" };
  });

  fastify.get("/cache", async (request: CacheRequest, reply) => {
    const requested = parseCacheOptions(request.query);
    const id = buildId(request.query.image, requested);
    const cached = fromCache(id);

    // found in cache, use it and return
    if (cached) {
      reply.type(cached.contentType).code(200);
      return cached.buffer;
    }

    // Concurrent requests that reach here for the same id share one download
    // and one transform. Everything inside runs once; every caller gets its
    // result and sets its own headers from it.
    const result = await coalesce(id, async () => {
      const image = await downloadImage(request.query.image);

      // axios types response header values as `AxiosHeaderValue | undefined`; older
      // typings resolved this to `string`. Cast rather than coerce so the runtime
      // path is byte-for-byte what it was — including BUG-22, where an upstream
      // content-type is relayed with no validation.
      const upstreamContentType = image.headers["content-type"] as string;

      // not supported, return as is.
      // Deliberately still not written to the cache: that is BUG-21, tracked by
      // its own ledger test and issue, and fixing it here would flip a test that
      // belongs to another change.
      if (!isSupported(upstreamContentType)) {
        return { contentType: upstreamContentType, body: image.data as Buffer };
      }

      const imageBuffer = Buffer.from(image.data, "binary");

      // animated gif, return as is. The mime guard matters: the animation probe
      // reads fixed offsets that carry unrelated data in other formats, so
      // running it on a non-gif is asking for a false positive.
      if (upstreamContentType === gifMime && isAnimatedGif(imageBuffer)) {
        toCache(id, {
          contentType: upstreamContentType,
          buffer: imageBuffer,
        });

        return { contentType: upstreamContentType, body: imageBuffer };
      }

      // compress image.
      //
      // The key now carries quality, format and the blur radius, but the
      // transform still ignores them — honouring them is the follow-up this
      // unblocks. Until then blur stays on the historical rule, so `blur=5`
      // remains unblurred rather than silently picking up the hardcoded radius.
      const compressedBuffer = await compress(imageBuffer, {
        contentType: upstreamContentType,
        width: requested.width,
        blur: request.query.blur === "true",
      });

      // use the smallest between original and compressed
      const imageBufferToUse = getSmallestImage(compressedBuffer, imageBuffer);

      toCache(id, {
        contentType: upstreamContentType,
        buffer: imageBufferToUse,
      });

      return { contentType: upstreamContentType, body: imageBufferToUse };
    });

    reply.type(result.contentType).code(200);
    reply.header("Cache-Control", cacheControl);
    return result.body;
  });

  return fastify;
}
