import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { registerAccountRoutes } from "./routes/accounts.ts";
import { registerDeviceRoutes } from "./routes/devices.ts";
import { registerPairingRoutes } from "./routes/pairing.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerWatchRoutes } from "./routes/watch.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Built dashboard, if present: services/api/src -> repo/web/dashboard/dist
const dashboardDist = join(here, "..", "..", "..", "web", "dashboard", "dist");

export async function buildServer(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  // Allow a separately-served dashboard (Vite dev) to call the API in development.
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  registerAccountRoutes(app);
  registerDeviceRoutes(app);
  registerPairingRoutes(app);
  registerEventRoutes(app);
  registerWatchRoutes(app);

  // Serve the built dashboard from the same origin, when it has been built.
  if (existsSync(dashboardDist)) {
    await app.register(fastifyStatic, { root: dashboardDist });
    // SPA fallback: anything that is not an API route or a real file returns index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/v1") && !req.url.startsWith("/health")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}
