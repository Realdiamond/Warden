// Prints fresh secrets for .env or the environment's secret store. Never commit them.
import { randomBytes } from "node:crypto";

console.log(`WARDEN_FIELD_KEY=${randomBytes(32).toString("base64")}`);
console.log(`WARDEN_HMAC_KEY=${randomBytes(32).toString("base64")}`);
