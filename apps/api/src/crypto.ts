// Field-level encryption for Restricted data (Security tab, section 4) and keyed hashing.
// AES-256-GCM with a per-value random IV; the purpose string is bound as associated data so a
// ciphertext cannot be moved from one column to another.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type Purpose =
  | "report.location"
  | "report.description"
  | "idempotency.response"
  | "session.details"
  | "session.viewToken"
  | "session.point"
  | "sms.message";

export interface FieldKeys {
  /** Key id written next to each ciphertext, so keys can be rotated. */
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export class Cipher {
  readonly #keys: FieldKeys;

  constructor(keys: FieldKeys) {
    for (const [id, key] of keys.keys) {
      if (key.length !== 32) throw new Error(`Field key ${id} must be 32 bytes`);
    }
    if (!keys.keys.has(keys.currentKeyId)) throw new Error("Current field key is missing");
    this.#keys = keys;
  }

  get currentKeyId(): string {
    return this.#keys.currentKeyId;
  }

  encrypt(purpose: Purpose, plaintext: string): Buffer {
    const key = this.#keys.keys.get(this.#keys.currentKeyId);
    if (!key) throw new Error("Current field key is missing");
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  decrypt(purpose: Purpose, keyId: string, payload: Buffer): string {
    const key = this.#keys.keys.get(keyId);
    if (!key) throw new Error(`Unknown field key: ${keyId}`);
    if (payload.length < 1 + IV_LENGTH + TAG_LENGTH || payload[0] !== VERSION) {
      throw new Error("Malformed ciphertext");
    }
    const iv = payload.subarray(1, 1 + IV_LENGTH);
    const tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const body = payload.subarray(1 + IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }

  encryptJson(purpose: Purpose, value: unknown): Buffer {
    return this.encrypt(purpose, JSON.stringify(value));
  }

  decryptJson<T>(purpose: Purpose, keyId: string, payload: Buffer): T {
    return JSON.parse(this.decrypt(purpose, keyId, payload)) as T;
  }
}

export class Hasher {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length < 32) throw new Error("HMAC key must be at least 32 bytes");
    this.#key = key;
  }

  /** Keyed hash; the label keeps hashes for different uses apart. */
  hmac(label: string, ...parts: string[]): Buffer {
    const mac = createHmac("sha256", this.#key);
    mac.update(label);
    for (const part of parts) {
      mac.update("\u0000");
      mac.update(part);
    }
    return mac.digest();
  }

  /** Short opaque string for in-memory keys such as rate limits. */
  hmacHex(label: string, ...parts: string[]): string {
    return this.hmac(label, ...parts).toString("hex");
  }
}

export function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
