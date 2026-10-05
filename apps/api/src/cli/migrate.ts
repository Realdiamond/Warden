import { migrate } from "../db/migrate.ts";
import { createPool } from "../db/pool.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const pool = createPool(url);
try {
  const ran = await migrate(pool);
  console.log(ran.length > 0 ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
} finally {
  await pool.end();
}
