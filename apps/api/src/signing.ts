// Ed25519 signing for responder broadcasts. Phones carry the public key from their build and
// show a broadcast as verified only when the signature checks out.

import { createPrivateKey, createPublicKey, type KeyObject, sign } from "node:crypto";

// DER prefix that wraps a raw 32-byte Ed25519 seed as a PKCS#8 private key.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export class Signer {
  readonly keyId: string;
  readonly #privateKey: KeyObject;
  readonly publicKey: Buffer;

  constructor(seed: Buffer, keyId: string) {
    if (seed.length !== 32) throw new Error("The signing key must be 32 bytes");
    this.keyId = keyId;
    this.#privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, seed]),
      format: "der",
      type: "pkcs8",
    });
    const spki = createPublicKey(this.#privateKey).export({ format: "der", type: "spki" });
    this.publicKey = spki.subarray(spki.length - 32);
  }

  sign(text: string): Buffer {
    return sign(null, Buffer.from(text, "utf8"), this.#privateKey);
  }
}
