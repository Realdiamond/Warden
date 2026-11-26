import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config.ts";

const KEY = Buffer.from(config.encryptionKeyHex, "hex"); // 32 bytes for AES-256

// --- Encryption at rest (AES-256-GCM) for sensitive payloads -----------------

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptJson<T = unknown>(blob: string): T {
  const [ivB, tagB, dataB] = blob.split(".");
  if (!ivB || !tagB || dataB === undefined) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}

// --- Password hashing (scrypt) ----------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB, hashB] = stored.split("$");
  if (scheme !== "scrypt" || !saltB || !hashB) return false;
  const expected = Buffer.from(hashB, "base64");
  const derived = scryptSync(password, Buffer.from(saltB, "base64"), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// --- Tokens & codes ----------------------------------------------------------

/** High-entropy opaque bearer (e.g. a device token). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 8-digit human-typeable pairing code. */
export function randomPairCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 100_000_000;
  return n.toString().padStart(8, "0");
}

/** Store only a hash of high-entropy tokens. SHA-256 is right here: the input is already random,
 * so there is nothing to brute-force, and lookups stay fast. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64");
}
