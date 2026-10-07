// Checks that a responder broadcast was signed by Warden (Ed25519) before the phone presents it
// as an official message. The public key is built into the app, so a tampered feed or a fake
// server cannot produce a "verified" broadcast.

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { broadcastSigningText, type SignedBroadcast } from "@warden/shared";

ed.hashes.sha512 = sha512;

export type BroadcastCheck = "verified" | "unverified" | "invalid";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Plain base64 decoding; Hermes has no Buffer. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    const value = BASE64.indexOf(char);
    if (value < 0) throw new Error("Not base64");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

/**
 * "verified" when the signature checks out with the built-in key, "invalid" when it does not
 * (the broadcast is then dropped), and "unverified" for test builds that carry no key.
 */
export function checkBroadcast(
  broadcast: SignedBroadcast,
  publicKeyBase64: string | null,
): BroadcastCheck {
  if (!publicKeyBase64) return "unverified";
  try {
    const message = new TextEncoder().encode(broadcastSigningText(broadcast));
    const ok = ed.verify(fromBase64(broadcast.signature), message, fromBase64(publicKeyBase64));
    return ok ? "verified" : "invalid";
  } catch {
    return "invalid";
  }
}
