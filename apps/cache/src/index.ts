import Fastify, { FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";
import { fromCache, toCache } from "./cache";

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
      return image.jpeg({ mozjpeg: true });
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

fastify.get("/cache", async (request: CacheRequest, reply) => {
  const cached = fromCache(request.query.image);

  if (cached) {
    reply.type(cached.contentType).code(200);
    return cached.buffer;
  }

  const image = await axios(request.query.image, {
    responseType: "arraybuffer",
  });

  const imageBuffer = Buffer.from(image.data, "binary");
  const compressedBuffer = await compress(imageBuffer, {
    contentType: image.headers["content-type"],
    width: Number(request.query.width),
    blur: request.query.blur === "true",
  });

  toCache(request.query.image, {
    contentType: image.headers["content-type"],
    buffer: compressedBuffer,
  });

  reply.type(image.headers["content-type"]).code(200);
  return compressedBuffer;
});

fastify.listen({ port: 4000 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
