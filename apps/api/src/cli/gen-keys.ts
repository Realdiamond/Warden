// Prints fresh secrets for .env or the environment's secret store. Never commit them.
//   gen-keys                       new secrets, plus the public key that matches the new signing key
//   gen-keys --public              the public key for the WARDEN_SIGNING_KEY already in the environment
//   gen-keys --new-field-key k2    a replacement field key, and the settings to switch to it
//   gen-keys --new-signing-key s2  a replacement signing key, and the app setting that trusts both
// See docs/deploy.md, "Changing keys".
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { Signer } from "../signing.ts";

const { values } = parseArgs({
  options: {
    public: { type: "boolean", default: false },
    "new-field-key": { type: "string" },
    "new-signing-key": { type: "string" },
  },
});

const KEY_ID = /^[a-z0-9-]{1,32}$/;
const publicKey = (seed: Buffer) => new Signer(seed, "-").publicKey.toString("base64");

function configuredKey(name: string): Buffer | null {
  const key = Buffer.from(process.env[name] ?? "", "base64");
  return key.length === 32 ? key : null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const newFieldId = values["new-field-key"];
const newSigningId = values["new-signing-key"];

if (values.public) {
  const configured = configuredKey("WARDEN_SIGNING_KEY");
  if (!configured) fail("WARDEN_SIGNING_KEY is not set (32 bytes, base64).");
  console.log("# Public half of the configured signing key. Not secret: give it to the Android");
  console.log("# build as the repository variable WARDEN_BROADCAST_PUBLIC_KEY.");
  console.log(`WARDEN_BROADCAST_PUBLIC_KEY=${publicKey(configured)}`);
} else if (newFieldId !== undefined) {
  const oldId = process.env.WARDEN_FIELD_KEY_ID || "k1";
  const oldKey = process.env.WARDEN_FIELD_KEY ?? "";
  if (!KEY_ID.test(newFieldId) || newFieldId === oldId) {
    fail(`Give the new key a new id (lowercase letters, digits, dashes), not "${oldId}".`);
  }
  if (!configuredKey("WARDEN_FIELD_KEY")) fail("WARDEN_FIELD_KEY is not set (32 bytes, base64).");
  const earlier = process.env.WARDEN_OLD_FIELD_KEYS?.trim();
  console.log("# 1. Replace these settings and restart the server. New data uses the new key;");
  console.log("#    old data stays readable with the old key.");
  console.log(`WARDEN_FIELD_KEY=${randomBytes(32).toString("base64")}`);
  console.log(`WARDEN_FIELD_KEY_ID=${newFieldId}`);
  console.log(`WARDEN_OLD_FIELD_KEYS=${earlier ? `${earlier},` : ""}${oldId}:${oldKey}`);
  console.log("# 2. Run rotate-field-key until it says everything is on the new key.");
  console.log(
    "# 3. Empty WARDEN_OLD_FIELD_KEYS and restart. Keep old backups' keys somewhere safe.",
  );
} else if (newSigningId !== undefined) {
  const oldId = process.env.WARDEN_SIGNING_KEY_ID || "s1";
  const oldSeed = configuredKey("WARDEN_SIGNING_KEY");
  if (!KEY_ID.test(newSigningId) || newSigningId === oldId) {
    fail(`Give the new key a new id (lowercase letters, digits, dashes), not "${oldId}".`);
  }
  const seed = randomBytes(32);
  const trusted = [
    ...(oldSeed ? [`${oldId}:${publicKey(oldSeed)}`] : []),
    `${newSigningId}:${publicKey(seed)}`,
  ].join(",");
  console.log("# 1. Set this repository variable and send out the new app build. Phones with it");
  console.log("#    trust both keys. Not secret.");
  console.log(`WARDEN_BROADCAST_PUBLIC_KEY=${trusted}`);
  console.log("# 2. Once most phones have updated, switch the server to the new key and restart:");
  console.log(`WARDEN_SIGNING_KEY=${seed.toString("base64")}`);
  console.log(`WARDEN_SIGNING_KEY_ID=${newSigningId}`);
  console.log("# 3. In a later build, drop the old key from WARDEN_BROADCAST_PUBLIC_KEY.");
} else {
  const seed = randomBytes(32);
  console.log(`WARDEN_FIELD_KEY=${randomBytes(32).toString("base64")}`);
  console.log(`WARDEN_HMAC_KEY=${randomBytes(32).toString("base64")}`);
  console.log(`WARDEN_SIGNING_KEY=${seed.toString("base64")}`);
  console.log("");
  console.log("# Public half of the signing key above. Not secret: give it to the Android build");
  console.log("# as the repository variable WARDEN_BROADCAST_PUBLIC_KEY.");
  console.log(`WARDEN_BROADCAST_PUBLIC_KEY=${publicKey(seed)}`);
}
