import http from "http";
import https from "https";
import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";
import { buildId, fromCache, toCache } from "./cache";
import { isAnimatedGif } from "./is-animated-gif";

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

export type CacheRequest = FastifyRequest<{
  Querystring: { image: string; width?: string; blur?: "true" | "false" };
}>;

export interface CompressOptions {
  contentType?: string;
  width?: number;
  blur?: boolean;
  quality?: number;
}

export const supportedMimes = ["image/png", "image/webp", "image/gif", "image/jpg", "image/jpeg"];

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
    const id = buildId(request.query.image, {
      width: Number(request.query.width),
      blur: request.query.blur === "true",
    });
    const cached = fromCache(id);

    // found in cache, use it and return
    if (cached) {
      reply.type(cached.contentType).code(200);
      return cached.buffer;
    }

    const image = await downloadImage(request.query.image);

    // not supported, return as is
    if (!isSupported(image.headers["content-type"])) {
      reply.type(image.headers["content-type"]).code(200);
      reply.header("Cache-Control", cacheControl);
      return image.data;
    }

    const imageBuffer = Buffer.from(image.data, "binary");

    // animated gif, return as is
    if (isAnimatedGif(imageBuffer)) {
      toCache(id, {
        contentType: image.headers["content-type"],
        buffer: imageBuffer,
      });

      reply.type(image.headers["content-type"]).code(200);
      reply.header("Cache-Control", cacheControl);
      return imageBuffer;
    }

    // compress image
    const compressedBuffer = await compress(imageBuffer, {
      contentType: image.headers["content-type"],
      width: Number(request.query.width),
      blur: request.query.blur === "true",
    });

    // use the smallest between original and compressed
    const imageBufferToUse = getSmallestImage(compressedBuffer, imageBuffer);

    toCache(id, {
      contentType: image.headers["content-type"],
      buffer: imageBufferToUse,
    });

    reply.type(image.headers["content-type"]).code(200);
    reply.header("Cache-Control", cacheControl);
    return imageBufferToUse;
  });

  return fastify;
}
