import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { migrate } from "./db/migrate.ts";
import { createPool } from "./db/pool.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

if (config.migrateOnStart) {
  const ran = await migrate(pool);
  if (ran.length > 0) console.log(`Applied migrations: ${ran.join(", ")}`);
}

const app = await buildApp({ config, pool, housekeepingIntervalMs: 60_000 });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
