import { buildServer } from "./server.ts";
import { config } from "./config.ts";

const app = await buildServer({ logger: true });

app
  .listen({ port: config.port, host: config.host })
  .then((address) => app.log.info(`Andsv API listening on ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
