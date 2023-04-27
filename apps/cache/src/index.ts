import Fastify, { FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";
import { buildId, fromCache, toCache } from "./cache";

type CacheRequest = FastifyRequest<{
  Querystring: { image: string; width?: string; blur?: "true" | "false" };
}>;

interface CompressOptions {
  contentType?: string;
  width?: number;
  blur?: boolean;
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

function imageFromMime(image: sharp.Sharp, mime?: string): sharp.Sharp {
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
      return image.jpeg({ mozjpeg: true, quality: 75 });
  }
}

function compress(buffer: Buffer, options: CompressOptions): Promise<Buffer> {
  // TODO: support animated gif/webp
  let image = sharp(buffer);

  if (options.width) {
    image = image.resize({ width: options.width || 1000, withoutEnlargement: true });
  }

  if (options.blur) {
    image = image.blur(10);
  }

  image = imageFromMime(image, options.contentType);

  return image.toBuffer();
}

function getSmallestImage(image1: Buffer, image2: Buffer): Buffer {
  return image1.byteLength < image2.byteLength ? image1 : image2;
}

fastify.get("/cache", async (request: CacheRequest, reply) => {
  const id = buildId(request.query.image, {
    width: Number(request.query.width),
    blur: request.query.blur === "true",
  });
  const cached = fromCache(id);

  if (cached) {
    reply.type(cached.contentType).code(200);
    return cached.buffer;
  }

  const image = await axios(request.query.image, {
    responseType: "arraybuffer",
  });

  if (!isSupported(image.headers["content-type"])) {
    reply.type(image.headers["content-type"]).code(200);
    return image.data;
  }

  const imageBuffer = Buffer.from(image.data, "binary");
  const compressedBuffer = await compress(imageBuffer, {
    contentType: image.headers["content-type"],
    width: Number(request.query.width),
    blur: request.query.blur === "true",
  });

  const imageBufferToUse = getSmallestImage(compressedBuffer, imageBuffer);

  toCache(id, {
    contentType: image.headers["content-type"],
    buffer: imageBufferToUse,
  });

  reply.type(image.headers["content-type"]).code(200);
  return imageBufferToUse;
});

fastify.listen({ port: 4000 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
