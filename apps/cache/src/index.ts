import Fastify from "fastify";

const fastify = Fastify({
  logger: true,
});

fastify.get("/", async (request, reply) => {
  reply.type("application/json").code(200);
  return { hello: "world" };
});

fastify.listen({ port: 4000 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
