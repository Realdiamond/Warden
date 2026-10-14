// Checks that a responder broadcast was signed by Warden (Ed25519) before the phone presents it
// as an official message. The public key is built into the app, so a tampered feed or a fake
// server cannot produce a "verified" broadcast.

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
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
 * The keys this build trusts, from WARDEN_BROADCAST_PUBLIC_KEY. Either one bare key (trusted for
 * any key id, as in builds before key rotation) or a list of "id:key" pairs separated by commas,
 * so a build can trust the current key and the next one while the server switches over.
 */
export function parseTrustedKeys(config: string | null): Map<string | null, string> {
  const keys = new Map<string | null, string>();
  for (const entry of (config ?? "").split(/[,\s]+/)) {
    if (!entry) continue;
    const colon = entry.indexOf(":");
    if (colon < 0) keys.set(null, entry);
    else keys.set(entry.slice(0, colon), entry.slice(colon + 1));
  }
  return keys;
}

/**
 * "verified" when the signature checks out with a built-in key, "invalid" when it does not or
 * the broadcast names a key this build does not trust (the broadcast is then dropped), and
 * "unverified" for test builds that carry no key.
 */
export function checkBroadcast(
  broadcast: SignedBroadcast,
  trustedKeys: string | null,
): BroadcastCheck {
  const keys = parseTrustedKeys(trustedKeys);
  if (keys.size === 0) return "unverified";
  const publicKeyBase64 = keys.get(broadcast.keyId) ?? keys.get(null);
  if (!publicKeyBase64) return "invalid";
  try {
    const message = new TextEncoder().encode(broadcastSigningText(broadcast));
    const ok = ed.verify(fromBase64(broadcast.signature), message, fromBase64(publicKeyBase64));
    return ok ? "verified" : "invalid";
  } catch {
    return "invalid";
  }
}

/** Lower-case hex SHA-256, as the server signs it. */
export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The spoken version of a broadcast, only if its bytes match the hash inside the signed
 * broadcast. A swapped or damaged recording is never played.
 */
export async function verifiedBroadcastAudio(
  broadcast: Pick<SignedBroadcast, "id" | "audioSha256">,
  download: (id: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> {
  if (!broadcast.audioSha256) return null;
  const bytes = await download(broadcast.id);
  if (!bytes) return null;
  return sha256Hex(bytes) === broadcast.audioSha256.toLowerCase() ? bytes : null;
}
