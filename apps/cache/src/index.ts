import "dotenv/config";
import { buildServer } from "./server";

const fastify = buildServer();

const host = "RENDER" in process.env ? `0.0.0.0` : `localhost`;
const port = Number(process.env.PORT) || 4000;

fastify.listen({ host, port }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
