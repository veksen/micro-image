import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import sharp from "sharp";
import { buildId, fromCache, fromSourceCache, toCache, toSourceCache } from "./cache";
import { probe } from "./is-animated";
import { coalesce } from "./coalesce";
import { createLimit, transformConcurrency } from "./limit";
import {
  createUpstream,
  parseTrustedOrigins,
  toUpstreamError,
  UpstreamError,
} from "./upstream-guard";

/**
 * libvips' operation cache only pays when the same operation repeats on the same
 * input, and every transform here starts from freshly downloaded bytes, so it
 * never hits. It still holds up to 100 operations and their images. Off, peak
 * RSS under 4 concurrent cold requests fell 9-16% (10 of 10 alternated pairs,
 * linux-arm64) with every output byte identical over the 840-case fingerprint.
 */
sharp.cache(false);

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
  /**
   * The embedded profile is one whose conversion to sRGB is a measured no-op
   * (`hasNoOpProfile`), so sharp may skip it. Output is identical either way.
   */
  noOpProfile?: boolean;
}

export const gifMime = "image/gif";

export const supportedMimes = ["image/png", "image/webp", gifMime, "image/jpg", "image/jpeg"];

/**
 * Formats `?format=` accepts, mapped to the mime each produces.
 *
 * `auto` is deliberately absent. An absent format already means "negotiate on
 * `Accept`" (see `negotiateFormat`), so a second spelling would only split the
 * cache. `original` is the way to opt out of negotiation.
 */
export const formatMimes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: gifMime,
};

/** An explicit request for whatever the source already is. */
export const passthroughFormat = "original";

/**
 * What `Accept` negotiation may pick, in the order a tie on q breaks. AVIF goes
 * first because it is the smaller of the two at the quality this proxy encodes.
 */
const negotiableFormats = ["avif", "webp"] as const;

/**
 * The format to encode to when the request named none, read from `Accept`.
 * Undefined means the client named neither, so the source format stands.
 *
 * Only an exact `image/avif` or `image/webp` entry counts. Every engine ends its
 * image `Accept` with an `image/*` or full wildcard, which formally matches AVIF too
 * (RFC 9110 §12.5.1), but a wildcard is how curl and old browsers say "anything".
 * Reading it as a request for AVIF would convert for clients that never asked.
 * An exact entry is also the most specific range for its type, so its q is the
 * one §12.5.1 says applies, and `q=0` correctly refuses it.
 */
export function negotiateFormat(accept: string | undefined): string | undefined {
  if (!accept) {
    return undefined;
  }

  let best: { rank: number; q: number } | undefined;

  for (const range of accept.split(",")) {
    const [type, ...params] = range.split(";").map((part) => part.trim().toLowerCase());
    const rank = negotiableFormats.findIndex((format) => type === `image/${format}`);

    if (rank === -1) {
      continue;
    }

    const qParam = params.find((param) => param.startsWith("q="));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));

    // q=0 refuses the type, and a malformed q is not a preference at all.
    if (!(q > 0 && q <= 1)) {
      continue;
    }

    if (best === undefined || q > best.q || (q === best.q && rank < best.rank)) {
      best = { rank, q };
    }
  }

  return best === undefined ? undefined : negotiableFormats[best.rank];
}

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

/**
 * What the proxy is willing to claim a response is.
 *
 * The upstream content type is attacker-influenced: the proxy fetches whatever
 * URL it is given, and relaying that header verbatim means asserting a type it
 * never checked. A missing header also reached the wire as the literal string
 * "undefined".
 *
 * Only well-formed image types are relayed, and only their bare type — a
 * charset or boundary parameter on an image is meaningless and is dropped.
 * Anything else resolves to the neutral binary type, which is honest: the
 * proxy has bytes it will serve but no type it is prepared to vouch for.
 */
export const fallbackMime = "application/octet-stream";

const imageMimePattern = /^image\/[a-z0-9][a-z0-9.+-]*$/;

export function resolveResponseMime(upstream: string | undefined): string {
  if (!upstream) {
    return fallbackMime;
  }

  const bare = upstream.split(";")[0]!.trim().toLowerCase();

  return imageMimePattern.test(bare) ? bare : fallbackMime;
}

/** Encoder quality when the request did not ask for one. */
const defaultQuality = 75;

/**
 * AVIF gets its own default, because the shared 75 is the wrong number for it.
 *
 * Measured on the benchmark photo fixture at 400w
 * (`docs/research/image-format-coverage.md` §7): `avif({quality: 50})` is 4,990
 * bytes against mozjpeg quality 75's 8,205 — 60.8% — and more faithful
 * (RMSE 2.87 vs 3.76). At quality 75 AVIF is 8,663 bytes, *larger* than mozjpeg,
 * so encoding it at the shared default would have made `?format=avif` a
 * regression rather than a saving.
 */
export const avifQuality = 50;

/**
 * aom's speed preset. Effort 3 (aom speed 6) is the knee on a cold path.
 *
 * Effort 3 is where aom's all-intra mode starts pruning its partition and
 * intra-mode search, so it costs a quarter of effort 4 for nearly the same file.
 * Measured on linux-x64, quality 50, 4:2:0, CPU per encode, effort 4 -> 3:
 *
 * - docs photo, 5272px -> 1200w: 3,360 -> 778 ms, 50,468 -> 51,752 bytes (+2.5%)
 * - docs photo -> 400w: 501 -> 125 ms, 7,467 -> 7,507 bytes (+0.5%)
 * - example-vite portrait, 1200px: 5,827 -> 1,300 ms, 107,670 -> 110,212 bytes (+2.4%)
 * - synthetic benchmark fixture -> 400w: 256 -> 71 ms, 3,572 -> 4,141 bytes (+16%)
 *
 * SSIM against the resized source fell by 0.001-0.003 on the photos and 0.008 on
 * the synthetic fixture, whose hard-edged sinusoids are not a photo.
 *
 * The cost matters because a cold AVIF request is paid serially: sharp runs
 * libvips single-threaded on glibc, so one 1200w AVIF at effort 4 is over three
 * seconds of wall time, and on a 1-CPU host four concurrent ones took 16 s each.
 *
 * Below 3 the files grow: effort 2 is 5,379 bytes on the synthetic fixture.
 */
export const avifEffort = 3;

/**
 * sharp encodes AVIF at 4:4:4 unless told otherwise, unlike its JPEG and WebP
 * encoders, which subsample by default.
 *
 * Measured on the benchmark photo fixture at 400w, quality 50, effort 4
 * (linux-x64): 4:2:0 is 3,572 bytes against 4:4:4's 4,591 (-22%) and 215 ms of
 * CPU against 301 ms (-29%). RMSE rises from 3.32 to 3.84, still below mozjpeg
 * quality 75's 4.34 at 8,205 bytes on the same measure. Saturated colour edges
 * (red text on a flat ground) are where 4:2:0 would show, and the fixture has
 * none.
 */
export const avifChromaSubsampling = "4:2:0";

export function imageFromMime(image: sharp.Sharp, mime?: string, quality?: number): sharp.Sharp {
  const effectiveQuality = quality ?? defaultQuality;

  switch (mime) {
    case "image/png":
      // png quality only bites with a palette, and forcing one would change the
      // output of every png request. Left lossless.
      return image.png();
    case "image/webp":
      return image.webp({ quality: effectiveQuality });
    case "image/avif":
      // An explicit ?quality= still wins: the default is a default, not a cap.
      return image.avif({
        quality: quality ?? avifQuality,
        effort: avifEffort,
        chromaSubsampling: avifChromaSubsampling,
      });
    case "image/gif":
      return image.gif();
    case "image/jpg":
    case "image/jpeg":
    default:
      return image.jpeg({ mozjpeg: true, quality: effectiveQuality });
  }
}

export function compress(buffer: Buffer, options: CompressOptions): Promise<Buffer> {
  let sharpImage = sharp(buffer, options.noOpProfile ? { ignoreIcc: true } : {});

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

/**
 * Long enough for a slow origin serving a large original, short enough that a
 * hung upstream does not hold a worker indefinitely. Override with
 * UPSTREAM_TIMEOUT_MS.
 */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * A ceiling on what one upstream response may cost in memory. Anything larger
 * is refused mid-stream rather than buffered. Override with UPSTREAM_MAX_BYTES.
 */
export const DEFAULT_MAX_UPSTREAM_BYTES = 32 * 1024 * 1024;

/** Unset falls back to the default. Set but unusable fails the boot. */
function readPositiveEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name]);

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

export interface BuildServerOptions {
  logger?: boolean;
  /** Overrides the env-configured limits. Mainly so tests can use a short timeout. */
  upstreamTimeoutMs?: number;
  maxUpstreamBytes?: number;
  /** Origins that skip the address check. Overrides `TRUSTED_ORIGINS`. */
  trustedOrigins?: readonly string[];
  /** Image transforms allowed at once. Overrides `TRANSFORM_CONCURRENCY`. */
  transformConcurrency?: number;
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

  // Configuration is read once, so a malformed value fails the boot.
  const upstream = createUpstream({
    trustedOrigins: parseTrustedOrigins(
      options.trustedOrigins ?? (process.env.TRUSTED_ORIGINS ?? "").split(",")
    ),
    timeoutMs:
      options.upstreamTimeoutMs ??
      readPositiveEnv("UPSTREAM_TIMEOUT_MS", DEFAULT_UPSTREAM_TIMEOUT_MS),
    maxBytes:
      options.maxUpstreamBytes ?? readPositiveEnv("UPSTREAM_MAX_BYTES", DEFAULT_MAX_UPSTREAM_BYTES),
  });

  // Every sharp call goes through this, so a burst of misses queues instead of
  // time-slicing more transforms than there are cores. See `createLimit`.
  const transform = createLimit(options.transformConcurrency ?? transformConcurrency());

  /**
   * The upstream original for a source url, downloaded at most once while it is
   * held. The response cache and its coalescer are keyed per variant, so without
   * this every width and format of one source pays its own download. Concurrent
   * misses for different variants share the one in flight.
   *
   * Only the body and its raw content type are kept. A failed fetch rejects
   * every waiter and is not retained, so the next request retries.
   */
  const fetchSource = (url: string) => {
    const held = fromSourceCache(url);
    if (held) {
      return Promise.resolve(held);
    }

    // `upstream.check` admits only http(s) urls, so no response id can collide
    return coalesce(`source:${url}`, async () => {
      const response = await upstream.fetch(url);
      const record = {
        // axios types header values as `AxiosHeaderValue | undefined`
        contentType: (response.headers["content-type"] as string | undefined) ?? "",
        buffer: response.data,
      };
      toSourceCache(url, record);
      return record;
    });
  };

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

    // Refuse a malformed URL or a blocked IP literal before the cache is read.
    try {
      upstream.check(request.query.image);
    } catch (error) {
      if (!(error instanceof UpstreamError)) {
        throw error;
      }

      reply.code(error.status);
      return { error: error.clientMessage };
    }

    // A request that named no format gets the best one its `Accept` names. The
    // resolved format replaces the absent one before the id is built, so the
    // cache and the coalescer both keep an AVIF and a WebP of one source apart.
    const negotiated = requested.format === undefined;
    const resolved = negotiated
      ? { ...requested, format: negotiateFormat(request.headers.accept) }
      : requested;

    const id = buildId(request.query.image, resolved);

    // Every successful response leaves through here, so the caching policy
    // cannot drift between branches again. It previously lived on three of the
    // four exits, and the one it was missing from was the cache hit — the path
    // most real traffic takes.
    const send = (contentType: string, body: Buffer) => {
      reply.type(contentType).code(200);
      reply.header("Cache-Control", cacheControl);

      // Set on every negotiated response, including the ones whose bytes turned
      // out not to depend on Accept (an SVG, an animation). The proxy only knows
      // that after the fetch, and an unneeded Vary costs a shared cache some hit
      // rate where a missing one serves AVIF to a client that cannot decode it.
      if (negotiated) {
        reply.header("Vary", "Accept");
      }

      return body;
    };

    const cached = fromCache(id);

    // found in cache, use it and return
    if (cached) {
      return send(cached.contentType, cached.buffer);
    }

    // Concurrent requests that reach here for the same id share one download
    // and one transform. Everything inside runs once; every caller gets its
    // result and sets its own headers from it.
    let result;

    try {
      result = await coalesce(id, async () => {
        const source = await fetchSource(request.query.image);

        // What reaches the wire is whatever resolveResponseMime is willing to
        // vouch for, never the raw header.
        const upstreamContentType = resolveResponseMime(source.contentType);

        // Not transformable, so relay it. It is cached too: the proxy is willing
        // to serve these bytes repeatedly, and an SVG that re-downloads from the
        // origin on every request is the same upstream load the cache exists to
        // remove.
        if (!isSupported(upstreamContentType)) {
          const body = source.buffer;
          toCache(id, { contentType: upstreamContentType, buffer: body });
          return { contentType: upstreamContentType, body };
        }

        const imageBuffer = source.buffer;

        // Animated input is relayed untouched, whatever container it arrived in.
        // sharp loads one page by default, so `resize()` returns a valid file
        // with every frame after the first silently discarded — 30 frames in,
        // 1 out, no error and no warning. Passing the bytes through keeps the
        // animation; the alternative is a transform that corrupts it.
        //
        // No mime guard: the probe asks the decoder rather than reading fixed
        // offsets, so it cannot mistake a JPEG's quantization table for a GIF
        // extension block the way the guard this replaced could.
        const probed = await transform(() => probe(imageBuffer));

        if (probed.frames !== null && probed.frames > 1) {
          toCache(id, {
            contentType: upstreamContentType,
            buffer: imageBuffer,
          });

          return { contentType: upstreamContentType, body: imageBuffer };
        }

        const outputMime = resolveOutputMime(resolved.format, upstreamContentType);

        let compressedBuffer: Buffer;

        try {
          compressedBuffer = await transform(() =>
            compress(imageBuffer, {
              contentType: outputMime,
              width: resolved.width,
              blur: resolved.blur,
              quality: resolved.quality,
              noOpProfile: probed.noOpProfile,
            })
          );
        } catch (error) {
          // The bytes are already here and the client wants an image, so serve
          // the original rather than turning one undecodable payload into a 500.
          // Cached under the same id: the inputs are unchanged, so a repeat of
          // this request would fail the same way, and not caching it would let a
          // deterministically bad image re-fetch from the origin on every hit.
          request.log.warn(
            { err: error, image: request.query.image, outputMime },
            "transform failed, serving the original bytes"
          );

          toCache(id, {
            contentType: upstreamContentType,
            buffer: imageBuffer,
          });

          return { contentType: upstreamContentType, body: imageBuffer };
        }

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
    } catch (error) {
      const failure = toUpstreamError(error);

      request.log.warn(
        { err: failure, image: request.query.image, status: failure.status },
        "could not fetch the image from upstream"
      );

      reply.code(failure.status);
      return { error: failure.clientMessage };
    }

    return send(result.contentType, result.body);
  });

  return fastify;
}
