import Fastify, { type FastifyServerOptions } from "fastify";
import { registerAccountRoutes } from "./routes/accounts.ts";
import { registerDeviceRoutes } from "./routes/devices.ts";
import { registerPairingRoutes } from "./routes/pairing.ts";
import { registerEventRoutes } from "./routes/events.ts";

export function buildServer(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  app.get("/health", async () => ({ ok: true }));

  registerAccountRoutes(app);
  registerDeviceRoutes(app);
  registerPairingRoutes(app);
  registerEventRoutes(app);

  return app;
}
