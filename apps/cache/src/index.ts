import Fastify, { FastifyRequest } from "fastify";
import axios from "axios";
import sharp from "sharp";

type CacheRequest = FastifyRequest<{
  Querystring: { image: string };
}>;

const fastify = Fastify({
  logger: true,
});

fastify.get("/", async (request, reply) => {
  reply.type("application/json").code(200);
  return { hello: "world" };
});

fastify.get("/cache", async (request: CacheRequest, reply) => {
  const image = await axios(request.query.image, {
    responseType: "arraybuffer",
  });

  const imageBuffer = Buffer.from(image.data, "binary");
  const compressedBuffer = sharp(imageBuffer)
    .resize({ width: 1000, withoutEnlargement: true })
    .jpeg({ mozjpeg: true })
    .toBuffer();

  reply.type("image/jpeg").code(200);
  return compressedBuffer;
});

fastify.listen({ port: 4000 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
