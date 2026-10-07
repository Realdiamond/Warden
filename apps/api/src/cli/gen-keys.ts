// Prints fresh secrets for .env or the environment's secret store. Never commit them.
import { randomBytes } from "node:crypto";
import { Signer } from "../signing.ts";

const seed = randomBytes(32);
console.log(`WARDEN_FIELD_KEY=${randomBytes(32).toString("base64")}`);
console.log(`WARDEN_HMAC_KEY=${randomBytes(32).toString("base64")}`);
console.log(`WARDEN_SIGNING_KEY=${seed.toString("base64")}`);
console.log("");
console.log("# Public half of the signing key. Not secret: give it to the Android build as");
console.log("# WARDEN_BROADCAST_PUBLIC_KEY so phones can check broadcasts.");
console.log(`WARDEN_BROADCAST_PUBLIC_KEY=${new Signer(seed, "s1").publicKey.toString("base64")}`);
