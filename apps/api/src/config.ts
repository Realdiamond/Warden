import { z } from "zod";

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
  WARDEN_HMAC_KEY: base64Key("WARDEN_HMAC_KEY"),
  COOKIE_SECURE: booleanString.optional(),
  TRUST_PROXY: booleanString.default(false),
  /** Folder with the built moderator console, served on the same origin when set. */
  CONSOLE_DIST: z.string().optional(),
  /** Tile and style hosts the console map may load from (comma-separated origins). */
  MAP_ORIGINS: z.string().default("https://tiles.openfreemap.org"),
  /** Run database migrations when the server starts (handy for small deployments). */
  MIGRATE_ON_START: booleanString.default(false),
});

export interface Config {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  fieldKeyId: string;
  fieldKey: Buffer;
  hmacKey: Buffer;
  cookieSecure: boolean;
  trustProxy: boolean;
  consoleDist: string | undefined;
  mapOrigins: string[];
  migrateOnStart: boolean;
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
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    fieldKeyId: e.WARDEN_FIELD_KEY_ID,
    fieldKey: e.WARDEN_FIELD_KEY,
    hmacKey: e.WARDEN_HMAC_KEY,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    trustProxy: e.TRUST_PROXY,
    consoleDist: e.CONSOLE_DIST,
    mapOrigins: e.MAP_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    migrateOnStart: e.MIGRATE_ON_START,
  };
}
