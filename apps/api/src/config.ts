import { z } from "zod";
import type { FieldKeys } from "./crypto.ts";

const base64Key = (name: string) =>
  z
    .string({ error: `${name} is required (run: pnpm --filter @warden/api gen-keys)` })
    .transform((value, ctx) => {
      const key = Buffer.from(value, "base64");
      if (key.length !== 32) {
        ctx.addIssue({ code: "custom", message: `${name} must be 32 bytes, base64-encoded` });
        return z.NEVER;
      }
      return key;
    });

/** Docker Compose passes unset optional values as empty strings; treat those as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  WARDEN_FIELD_KEY: base64Key("WARDEN_FIELD_KEY"),
  WARDEN_FIELD_KEY_ID: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default("k1"),
  /**
   * Earlier field keys, still needed to read data locked with them until rotate-field-key has
   * re-encrypted it: "k1:<base64>,k2:<base64>".
   */
  WARDEN_OLD_FIELD_KEYS: optional(z.string()),
  WARDEN_HMAC_KEY: base64Key("WARDEN_HMAC_KEY"),
  COOKIE_SECURE: booleanString.optional(),
  TRUST_PROXY: booleanString.default(false),
  /** Folder with the built moderator console, served on the same origin when set. */
  CONSOLE_DIST: z.string().optional(),
  /** Tile and style hosts the console map may load from (comma-separated origins). */
  MAP_ORIGINS: z.string().default("https://tiles.openfreemap.org"),
  /** Run database migrations when the server starts (handy for small deployments). */
  MIGRATE_ON_START: booleanString.default(false),
  /** Public address of this server, used in links sent to trusted contacts. */
  PUBLIC_WEB_URL: optional(
    z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/, "PUBLIC_WEB_URL must be a full URL"),
  ),
  /** "log" until an SMS provider account exists. */
  SMS_DRIVER: z.enum(["log", "termii"]).default("log"),
  TERMII_API_KEY: optional(z.string()),
  TERMII_SENDER_ID: z.string().max(11).default("Warden"),
  TERMII_BASE_URL: z.string().default("https://api.ng.termii.com"),
  /** Ed25519 seed (base64, 32 bytes) for signing broadcasts; broadcasts are off without it. */
  WARDEN_SIGNING_KEY: optional(base64Key("WARDEN_SIGNING_KEY")),
  WARDEN_SIGNING_KEY_ID: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default("s1"),
  /** Secret part of the USSD callback address given to the USSD provider; USSD is off without it. */
  USSD_CALLBACK_SECRET: optional(z.string().min(24)),
  /** Safety valve: at most this many text messages an hour across the whole service. */
  SMS_HOURLY_CAP: z.coerce.number().int().min(1).default(500),
});

export interface Config {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  fieldKeyId: string;
  fieldKey: Buffer;
  /** The current field key and any old ones, for the Cipher. */
  fieldKeys: FieldKeys;
  hmacKey: Buffer;
  cookieSecure: boolean;
  trustProxy: boolean;
  consoleDist: string | undefined;
  mapOrigins: string[];
  migrateOnStart: boolean;
  publicWebUrl: string | null;
  signingKey: { id: string; seed: Buffer } | null;
  ussdCallbackSecret: string | null;
  sms:
    | { driver: "log"; hourlyCap: number }
    | { driver: "termii"; hourlyCap: number; apiKey: string; senderId: string; baseUrl: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `- ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  const e = parsed.data;
  const fieldKeys = parseFieldKeys(
    e.WARDEN_FIELD_KEY_ID,
    e.WARDEN_FIELD_KEY,
    e.WARDEN_OLD_FIELD_KEYS,
  );
  if (e.SMS_DRIVER === "termii" && !e.TERMII_API_KEY) {
    throw new Error("Invalid configuration:\n- TERMII_API_KEY is required when SMS_DRIVER=termii");
  }
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    fieldKeyId: e.WARDEN_FIELD_KEY_ID,
    fieldKey: e.WARDEN_FIELD_KEY,
    fieldKeys,
    hmacKey: e.WARDEN_HMAC_KEY,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    trustProxy: e.TRUST_PROXY,
    consoleDist: e.CONSOLE_DIST,
    mapOrigins: e.MAP_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    migrateOnStart: e.MIGRATE_ON_START,
    publicWebUrl: e.PUBLIC_WEB_URL?.replace(/\/+$/, "") ?? null,
    signingKey: e.WARDEN_SIGNING_KEY
      ? { id: e.WARDEN_SIGNING_KEY_ID, seed: e.WARDEN_SIGNING_KEY }
      : null,
    ussdCallbackSecret: e.USSD_CALLBACK_SECRET ?? null,
    sms:
      e.SMS_DRIVER === "termii"
        ? {
            driver: "termii",
            hourlyCap: e.SMS_HOURLY_CAP,
            apiKey: e.TERMII_API_KEY ?? "",
            senderId: e.TERMII_SENDER_ID,
            baseUrl: e.TERMII_BASE_URL,
          }
        : { driver: "log", hourlyCap: e.SMS_HOURLY_CAP },
  };
}

function parseFieldKeys(currentId: string, current: Buffer, old: string | undefined): FieldKeys {
  const keys = new Map<string, Buffer>([[currentId, current]]);
  for (const entry of (old ?? "").split(/[,\s]+/)) {
    if (!entry) continue;
    const colon = entry.indexOf(":");
    const id = entry.slice(0, colon);
    const key = Buffer.from(entry.slice(colon + 1), "base64");
    const problem =
      colon < 1 || !/^[a-z0-9-]{1,32}$/.test(id)
        ? "entries must look like k1:<base64 key>"
        : key.length !== 32
          ? `key ${id} must be 32 bytes, base64-encoded`
          : keys.has(id)
            ? `key id ${id} is used twice (the current key must have a new id)`
            : null;
    if (problem) {
      throw new Error(`Invalid configuration:\n- WARDEN_OLD_FIELD_KEYS: ${problem}`);
    }
    keys.set(id, key);
  }
  return { currentKeyId: currentId, keys };
}
