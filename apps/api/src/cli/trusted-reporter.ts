// Gives a checked person (community leader, journalist, partner staff) a trusted reporter code,
// or takes one back. Their high-severity reports then go on the map without waiting for a second
// report. Check who they are first; every change is written to the audit log.
//   pnpm --filter @warden/api trusted-reporter -- --add "Ikeja CDA chair (Mrs A.)"
//   pnpm --filter @warden/api trusted-reporter -- --revoke <id> --reason "Left the role"

import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { Hasher } from "../crypto.ts";
import { createPool } from "../db/pool.ts";
import { createTrustedReporter, revokeTrustedReporter } from "../services/trustedReporters.ts";

const { values } = parseArgs({
  options: {
    add: { type: "string" },
    revoke: { type: "string" },
    reason: { type: "string" },
    by: { type: "string", default: "cli" },
  },
});

if (!values.add === !values.revoke || (values.revoke && !values.reason)) {
  console.error(
    'Usage: trusted-reporter --add "<who, for your records>" | --revoke <id> --reason "<why>"',
  );
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const now = () => new Date();
try {
  if (values.add) {
    const { id, code } = await createTrustedReporter(
      { pool, hasher: new Hasher(config.hmacKey), now },
      values.add,
      values.by,
    );
    console.log(`Trusted reporter ${id} (${values.add})`);
    console.log(`Code (shown once; give it to them in person or by phone): ${code}`);
    console.log("They enter it in the app under Settings > Trusted reporter code.");
  } else if (values.revoke) {
    const done = await revokeTrustedReporter(
      { pool, now },
      values.revoke,
      values.by,
      values.reason ?? "",
    );
    console.log(done ? "Code revoked." : "No active trusted reporter with that id.");
    if (!done) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
