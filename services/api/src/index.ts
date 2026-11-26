import { buildServer } from "./server.ts";
import { config } from "./config.ts";

const app = buildServer({ logger: true });

app
  .listen({ port: config.port, host: config.host })
  .then((address) => app.log.info(`Monitor API listening on ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
