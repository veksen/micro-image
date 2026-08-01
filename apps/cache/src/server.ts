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

/** Encoder quality is a hint, so out-of-range values clamp rather than fail. */
export const minQuality = 1;
export const maxQuality = 100;

function parseQuality(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(maxQuality, Math.max(minQuality, Math.round(parsed)));
}

/** sharp rejects a blur sigma outside this range. */
const minBlur = 0.3;
const maxBlur = 1000;

function parseBlur(value?: string): number | undefined {
  // The published client still sends the legacy boolean.
  if (value === "true") {
    return legacyBlurRadius;
  }

  const parsed = positiveNumber(value);

  return parsed === undefined ? undefined : Math.min(maxBlur, Math.max(minBlur, parsed));
}

/**
 * Parses the query string once, so the cache key and the transform cannot
 * disagree about what was asked for. That disagreement was the actual defect
 * behind BUG-17: `buildId` includes any key handed to it, and the route only
 * ever handed it two.
 *
 * Values are normalised to what will actually be applied — clamped, rounded,
 * lowercased — so two requests that differ only in a value the encoder would
 * treat identically share one cache entry.
 */
export function parseCacheOptions(query: CacheQuerystring): CacheOptions {
  return {
    width: positiveNumber(query.width),
    quality: parseQuality(query.quality),
    format: query.format ? query.format.toLowerCase() : undefined,
    blur: parseBlur(query.blur),
  };
}

export interface CompressOptions {
  /** The mime to encode **to**, not the mime that came from upstream. */
  contentType?: string;
  width?: number;
  /** Blur sigma. Absent means no blur. */
  blur?: number;
  quality?: number;
}

export const gifMime = "image/gif";

export const supportedMimes = ["image/png", "image/webp", gifMime, "image/jpg", "image/jpeg"];

/**
 * Formats `?format=` accepts, mapped to the mime each produces.
 *
 * `auto` is deliberately absent. ADR 0004 reserves "the proxy decides" for
 * `Accept`-header negotiation, so it should mean that when it lands rather
 * than quietly meaning "source format" now.
 */
export const formatMimes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: gifMime,
};

/** An explicit request for whatever the source already is. */
export const passthroughFormat = "original";

export const cacheControl =
  "public, max-age=2592000, stale-while-revalidate=60, stale-if-error=43200, immutable";

export function isSupported(mime: string): boolean {
  return supportedMimes.includes(mime);
}

export function isSupportedFormat(format: string): boolean {
  return format === passthroughFormat || format in formatMimes;
}

/**
 * The mime the response will actually carry: the requested format when one was
 * asked for, otherwise whatever came from upstream.
 */
export function resolveOutputMime(format: string | undefined, upstreamMime: string): string {
  if (format === undefined || format === passthroughFormat) {
    return upstreamMime;
  }

  return formatMimes[format] ?? upstreamMime;
}

export function imageFromMime(image: sharp.Sharp, mime?: string, quality?: number): sharp.Sharp {
  const effectiveQuality = quality ?? 75;

  switch (mime) {
    case "image/png":
      // png quality only bites with a palette, and forcing one would change the
      // output of every png request. Left lossless.
      return image.png();
    case "image/webp":
      return image.webp({ quality: effectiveQuality });
    case "image/gif":
      return image.gif();
    case "image/jpg":
    case "image/jpeg":
    default:
      return image.jpeg({ mozjpeg: true, quality: effectiveQuality });
  }
}

export function compress(buffer: Buffer, options: CompressOptions): Promise<Buffer> {
  let sharpImage = sharp(buffer);

  if (options.width) {
    sharpImage = sharpImage.resize({ width: options.width, withoutEnlargement: true });
  }

  if (options.blur) {
    sharpImage = sharpImage.blur(options.blur);
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

    // Refuse an unencodable format before doing any work, so a typo cannot mint
    // a cache entry or cost an upstream fetch.
    if (requested.format !== undefined && !isSupportedFormat(requested.format)) {
      reply.code(400);
      return {
        error: `unsupported format "${requested.format}"`,
        supported: [...Object.keys(formatMimes), passthroughFormat],
      };
    }

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

      const outputMime = resolveOutputMime(requested.format, upstreamContentType);

      const compressedBuffer = await compress(imageBuffer, {
        contentType: outputMime,
        width: requested.width,
        blur: requested.blur,
        quality: requested.quality,
      });

      // Use the smallest of the two, but only when both are the same format.
      // Handing back the original because it happens to be smaller would answer
      // `?format=webp` with jpeg bytes labelled image/webp.
      const converted = outputMime !== upstreamContentType;
      const imageBufferToUse = converted
        ? compressedBuffer
        : getSmallestImage(compressedBuffer, imageBuffer);

      // The original survives only on the un-converted path, so it is still the
      // upstream mime; anything else is what we just encoded.
      const servedMime = imageBufferToUse === imageBuffer ? upstreamContentType : outputMime;

      toCache(id, {
        contentType: servedMime,
        buffer: imageBufferToUse,
      });

      return { contentType: servedMime, body: imageBufferToUse };
    });

    reply.type(result.contentType).code(200);
    reply.header("Cache-Control", cacheControl);
    return result.body;
  });

  return fastify;
}
