import { randomBytes } from "node:crypto";

// Secrets come from the environment. For local dev we generate ephemeral ones and warn loudly —
// never rely on these in anything a real phone talks to.
const ephemeral: string[] = [];

function secret(name: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  ephemeral.push(name);
  return randomBytes(32).toString("hex");
}

function encryptionKey(): string {
  const v = process.env.MONITOR_ENCRYPTION_KEY;
  if (v && /^[0-9a-fA-F]{64}$/.test(v)) return v;
  if (v) throw new Error("MONITOR_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  ephemeral.push("MONITOR_ENCRYPTION_KEY");
  return randomBytes(32).toString("hex");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: secret("MONITOR_JWT_SECRET"),
  encryptionKeyHex: encryptionKey(),
  dbFile: process.env.MONITOR_DB ?? "monitor.db",
};

if (ephemeral.length > 0) {
  console.warn(
    `[monitor] Using EPHEMERAL secrets for: ${ephemeral.join(", ")}. ` +
      `Set these in the environment for anything beyond local dev — otherwise a restart ` +
      `invalidates all tokens and makes stored encrypted data unreadable.`,
  );
}
