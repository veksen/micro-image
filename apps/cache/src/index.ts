import "dotenv/config";
import http from "http";
import https from "https";
import Fastify, { FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";
import { buildId, fromCache, toCache } from "./cache";
import { isAnimatedGif } from "./is-animated-gif";

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

type CacheRequest = FastifyRequest<{
  Querystring: { image: string; width?: string; blur?: "true" | "false" };
}>;

interface CompressOptions {
  contentType?: string;
  width?: number;
  blur?: boolean;
  quality?: number;
}

const fastify = Fastify({
  logger: true,
});

fastify.get("/", async (request, reply) => {
  reply.type("application/json").code(200);
  return { hello: "world" };
});

const supportedMimes = ["image/png", "image/webp", "image/gif", "image/jpg", "image/jpeg"];

function isSupported(mime: string): boolean {
  return supportedMimes.includes(mime);
}

function imageFromMime(image: sharp.Sharp, mime?: string, quality?: number): sharp.Sharp {
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

function compress(buffer: Buffer, options: CompressOptions): Promise<Buffer> {
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

function getSmallestImage(image1: Buffer, image2: Buffer): Buffer {
  return image1.byteLength < image2.byteLength ? image1 : image2;
}

async function downloadImage(url: string) {
  return axios(url, {
    responseType: "arraybuffer",
    httpAgent,
    httpsAgent,
  });
}

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
  return imageBufferToUse;
});

fastify.listen({ port: Number(process.env.PORT) || 4000 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
