// Crypto for the Cloudflare Worker, using Web Crypto (no Node APIs).

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// --- AES-256-GCM (Web Crypto appends the auth tag to the ciphertext) ----------

async function aesKey(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", hexToBytes(hex), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJson(value: unknown, keyHex: string): Promise<string> {
  const key = await aesKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt));
  return `${toB64(iv)}.${toB64(ct)}`;
}

export async function decryptJson<T = unknown>(blob: string, keyHex: string): Promise<T> {
  const [ivB, ctB] = blob.split(".");
  if (!ivB || !ctB) throw new Error("malformed ciphertext");
  const key = await aesKey(keyHex);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB) },
    key,
    fromB64(ctB),
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// --- Password hashing (PBKDF2-SHA256; scrypt isn't in Web Crypto) --------------

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterS, saltB, hashB] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterS || !saltB || !hashB) return false;
  const expected = fromB64(hashB);
  const got = await pbkdf2(password, fromB64(saltB), parseInt(iterS, 10));
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ expected[i]!;
  return diff === 0;
}

// --- Tokens & codes -----------------------------------------------------------

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return toB64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomPairCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 100_000_000;
  return n.toString().padStart(8, "0");
}

export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toB64(new Uint8Array(d));
}
