// Re-encrypts all stored private data (exact locations, report text, trip details, queued texts)
// with the current WARDEN_FIELD_KEY, so the keys in WARDEN_OLD_FIELD_KEYS can be removed.
//   pnpm --filter @warden/api rotate-field-key            re-encrypt, then report what is left
//   pnpm --filter @warden/api rotate-field-key --check    only report rows still on old keys
// Safe to run while the server is up, and safe to run again.

import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { Cipher } from "../crypto.ts";
import { createPool } from "../db/pool.ts";
import { countOldKeyRows, reencryptOldKeyRows } from "../services/keyRotation.ts";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const current = config.fieldKeyId;
  if (!values.check) {
    const done = await reencryptOldKeyRows({
      pool,
      cipher: new Cipher(config.fieldKeys),
      now: () => new Date(),
    });
    const total = Object.values(done).reduce((a, b) => a + b, 0);
    console.log(`Re-encrypted ${total} rows with key ${current}.`);
  }
  const left = await countOldKeyRows(pool, current);
  const remaining = Object.entries(left).filter(([, n]) => n > 0);
  if (remaining.length === 0) {
    console.log(`Everything is on key ${current}.`);
    if (config.fieldKeys.keys.size > 1) console.log("WARDEN_OLD_FIELD_KEYS can now be emptied.");
  } else {
    for (const [table, n] of remaining) console.log(`${table}: ${n} rows still on an old key`);
    console.log("Run this again (rows in use at that moment are skipped and picked up next time).");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
