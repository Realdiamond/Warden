// Applies pending src/db/migrations/*.sql files in name order, all in one transaction, so a
// failed migration leaves the database unchanged.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Pool, withTransaction } from "./pool.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export async function migrate(pool: Pool): Promise<string[]> {
  // Serialise concurrent runners (for example two servers starting at once).
  return withTransaction(pool, async (lockClient) => {
    await lockClient.query("SELECT pg_advisory_xact_lock(724001)");
    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await lockClient.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.version));
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      try {
        await lockClient.query(sql);
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      await lockClient.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      ran.push(file);
    }
    return ran;
  });
}
