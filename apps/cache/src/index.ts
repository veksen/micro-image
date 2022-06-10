import Fastify, { FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";

type CacheRequest = FastifyRequest<{
  Querystring: { image: string };
}>;

const cache: Record<string, Buffer> = {};

const fastify = Fastify({
  logger: true,
});

fastify.get("/", async (request, reply) => {
  reply.type("application/json").code(200);
  return { hello: "world" };
});

function fromCache(id: string): Buffer | undefined {
  return cache[id];
}

function toCache(id: string, buffer: Buffer): void {
  cache[id] = buffer;
}

function compress(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 1000, withoutEnlargement: true })
    .jpeg({ mozjpeg: true })
    .toBuffer();
}

fastify.get("/cache", async (request: CacheRequest, reply) => {
  const cached = fromCache(request.query.image);

  if (cached) {
    reply.type("image/jpeg").code(200);
    return cached;
  }

  const image = await axios(request.query.image, {
    responseType: "arraybuffer",
  });

  const imageBuffer = Buffer.from(image.data, "binary");
  const compressedBuffer = await compress(imageBuffer);

  toCache(request.query.image, compressedBuffer);

  reply.type("image/jpeg").code(200);
  return compressedBuffer;
});

fastify.listen({ port: 4000 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
