// Creates a moderator, admin or responder account.
//   pnpm --filter @warden/api create-staff -- --email you@example.com --role admin
//   pnpm --filter @warden/api create-staff -- --email desk@police.example --role responder --org <id>
// The password comes from STAFF_PASSWORD, or a strong one is generated and printed once.

import { parseArgs } from "node:util";
import { randomToken } from "../crypto.ts";
import { createPool } from "../db/pool.ts";
import { createStaff } from "../services/staff.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    role: { type: "string", default: "moderator" },
    org: { type: "string" },
  },
});

const url = process.env.DATABASE_URL;
const role = values.role;
const validRole = role === "moderator" || role === "admin" || role === "responder";
if (!url || !values.email || !validRole || (role === "responder" && !values.org)) {
  console.error(
    "Usage: create-staff --email <email> [--role moderator|admin|responder] [--org <organisation id>]\n" +
      "Responders need --org (see create-org). Needs DATABASE_URL.",
  );
  process.exit(1);
}

const generated = !process.env.STAFF_PASSWORD;
const password = process.env.STAFF_PASSWORD ?? randomToken(18);
const pool = createPool(url);
try {
  const staff = await createStaff(
    pool,
    { email: values.email, password, role, organisationId: values.org ?? null },
    new Date(),
  );
  console.log(`Created ${staff.role} ${staff.email}`);
  if (generated) console.log(`Password (shown once, store it in a password manager): ${password}`);
} finally {
  await pool.end();
}
