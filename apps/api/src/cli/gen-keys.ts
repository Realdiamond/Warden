// Prints fresh secrets for .env or the environment's secret store. Never commit them.
//   gen-keys            new secrets, plus the public key that matches the new signing key
//   gen-keys --public   the public key for the WARDEN_SIGNING_KEY already in the environment
import { randomBytes } from "node:crypto";
import { Signer } from "../signing.ts";

const publicLine = (seed: Buffer) =>
  `WARDEN_BROADCAST_PUBLIC_KEY=${new Signer(seed, "s1").publicKey.toString("base64")}`;

if (process.argv.includes("--public")) {
  const configured = Buffer.from(process.env.WARDEN_SIGNING_KEY ?? "", "base64");
  if (configured.length !== 32) {
    console.error("WARDEN_SIGNING_KEY is not set (32 bytes, base64).");
    process.exit(1);
  }
  console.log("# Public half of the configured signing key. Not secret: give it to the Android");
  console.log("# build as the repository variable WARDEN_BROADCAST_PUBLIC_KEY.");
  console.log(publicLine(configured));
} else {
  const seed = randomBytes(32);
  console.log(`WARDEN_FIELD_KEY=${randomBytes(32).toString("base64")}`);
  console.log(`WARDEN_HMAC_KEY=${randomBytes(32).toString("base64")}`);
  console.log(`WARDEN_SIGNING_KEY=${seed.toString("base64")}`);
  console.log("");
  console.log("# Public half of the signing key above. Not secret: give it to the Android build");
  console.log("# as the repository variable WARDEN_BROADCAST_PUBLIC_KEY.");
  console.log(publicLine(seed));
}
