// Gives a paying customer a key for the risk-data API, takes one back, or prints their usage
// for an invoice. Every key change is written to the audit log. See docs/data-api.md.
//   pnpm --filter @warden/api api-client -- --add "Acme Insurance" --quota 5000
//   pnpm --filter @warden/api api-client -- --revoke <id> --reason "Contract ended"
//   pnpm --filter @warden/api api-client -- --usage <id> --month 2026-10

import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { Hasher } from "../crypto.ts";
import { createPool } from "../db/pool.ts";
import { createApiClient, revokeApiClient } from "../services/dataApi.ts";

const { values } = parseArgs({
  options: {
    add: { type: "string" },
    quota: { type: "string", default: "1000" },
    revoke: { type: "string" },
    reason: { type: "string" },
    usage: { type: "string" },
    month: { type: "string" },
    by: { type: "string", default: "cli" },
  },
});

const actions = [values.add, values.revoke, values.usage].filter(Boolean).length;
const quota = Number(values.quota);
if (
  actions !== 1 ||
  (values.revoke && !values.reason) ||
  !Number.isInteger(quota) ||
  quota < 1 ||
  (values.month && !/^\d{4}-\d{2}$/.test(values.month))
) {
  console.error(
    'Usage: api-client --add "<customer>" [--quota <requests a day>]\n' +
      '       api-client --revoke <id> --reason "<why>"\n' +
      "       api-client --usage <id> [--month YYYY-MM]",
  );
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const now = () => new Date();
try {
  if (values.add) {
    const { id, key } = await createApiClient(
      { pool, hasher: new Hasher(config.hmacKey), now },
      { name: values.add, dailyQuota: quota },
      values.by,
    );
    console.log(`API customer ${id} (${values.add}), ${quota} requests a day`);
    console.log(`Key (shown once; send it to the customer securely): ${key}`);
  } else if (values.revoke) {
    const done = await revokeApiClient(
      { pool, now },
      values.revoke,
      values.by,
      values.reason ?? "",
    );
    console.log(done ? "Key revoked." : "No active customer with that id.");
    if (!done) process.exitCode = 1;
  } else if (values.usage) {
    const month = values.month ?? new Date().toISOString().slice(0, 7);
    const { rows } = await pool.query<{ day: string; requests: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, requests FROM api_usage
        WHERE client_id = $1 AND to_char(day, 'YYYY-MM') = $2 ORDER BY day`,
      [values.usage, month],
    );
    let total = 0;
    for (const row of rows) {
      total += row.requests;
      console.log(`${row.day}  ${row.requests}`);
    }
    console.log(`Total for ${month}: ${total} requests`);
  }
} finally {
  await pool.end();
}
