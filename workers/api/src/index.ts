import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  encryptJson,
  decryptJson,
  hashPassword,
  verifyPassword,
  hashToken,
  randomToken,
  randomPairCode,
} from "./crypto.ts";
import { signAccountToken, verifyAccountToken, bearer } from "./auth.ts";

import { ASSETS } from "./assets.ts";

interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  ANDSV_JWT_SECRET: string;
  ANDSV_ENCRYPTION_KEY: string;
}

/**
 * Per-device relay for live screen view and remote control. The monitored device connects as the
 * "source" (sends screen frames); the parent dashboard connects as a "viewer" (receives frames,
 * sends control commands). Frames go source→viewers; control messages go viewer→source.
 */
export class StreamRelay implements DurableObject {
  private source: WebSocket | null = null;
  private viewers = new Set<WebSocket>();

  constructor(
    _state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (role === "source") {
      this.source?.close(1000, "replaced");
      this.source = server;
      this.notifySource();
      server.addEventListener("message", (e) => {
        for (const v of this.viewers) {
          try {
            v.send(e.data);
          } catch {
            this.viewers.delete(v);
          }
        }
      });
      server.addEventListener("close", () => {
        if (this.source === server) this.source = null;
      });
    } else {
      this.viewers.add(server);
      this.notifySource();
      server.addEventListener("message", (e) => {
        try {
          this.source?.send(e.data);
        } catch {
          /* source gone */
        }
      });
      server.addEventListener("close", () => {
        this.viewers.delete(server);
        this.notifySource();
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private notifySource() {
    try {
      this.source?.send(JSON.stringify({ type: "viewers", count: this.viewers.size }));
    } catch {
      /* ignore */
    }
  }
}

const EVENT_KINDS = ["location", "app_usage", "message", "call", "screen", "control", "status"];
const SENSITIVE_KINDS = new Set(["location", "message", "call"]);
const PAIR_CODE_TTL_MS = 15 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*" }));

app.get("/health", (c) => c.json({ ok: true }));

// --- Accounts ---------------------------------------------------------------

app.post("/v1/accounts", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email ?? "").toLowerCase().trim();
  const password = String(body?.password ?? "");
  if (!EMAIL_RE.test(email) || password.length < 8) return c.json({ error: "invalid_body" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "email_taken" }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, email, await hashPassword(password), new Date().toISOString())
    .run();

  return c.json({ accountId: id, token: await signAccountToken(id, c.env.ANDSV_JWT_SECRET) }, 201);
});

app.post("/v1/sessions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email ?? "").toLowerCase().trim();
  const password = String(body?.password ?? "");
  if (!EMAIL_RE.test(email) || password.length < 8) return c.json({ error: "invalid_body" }, 400);

  const row = await c.env.DB.prepare("SELECT id, password_hash FROM accounts WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  return c.json({ accountId: row.id, token: await signAccountToken(row.id, c.env.ANDSV_JWT_SECRET) });
});

// --- Helpers ----------------------------------------------------------------

async function requireAccount(c: { req: { header: (n: string) => string | undefined }; env: Env }) {
  const token = bearer(c.req.header("authorization"));
  if (!token) return null;
  return verifyAccountToken(token, c.env.ANDSV_JWT_SECRET);
}

interface DeviceRow {
  id: string;
  name: string | null;
  platform: string | null;
  paired_at: string | null;
  consent_accepted_at: string | null;
  last_seen_at: string | null;
  blocked_apps: string | null;
}

function parseBlocked(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toSummary(r: DeviceRow) {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    pairedAt: r.paired_at,
    consentAcceptedAt: r.consent_accepted_at,
    lastSeenAt: r.last_seen_at,
    blockedApps: parseBlocked(r.blocked_apps),
  };
}

const DEVICE_COLS =
  "id, name, platform, paired_at, consent_accepted_at, last_seen_at, blocked_apps";

// --- Devices ----------------------------------------------------------------

app.post("/v1/devices", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const name = body?.name == null ? null : String(body.name).slice(0, 100);

  const id = crypto.randomUUID();
  const pairCode = randomPairCode();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO devices (id, account_id, name, pair_code, pair_code_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, accountId, name, pairCode, new Date(now + PAIR_CODE_TTL_MS).toISOString(), new Date(now).toISOString())
    .run();

  return c.json({ deviceId: id, pairCode, pairCodeExpiresInMs: PAIR_CODE_TTL_MS }, 201);
});

app.get("/v1/devices", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT ${DEVICE_COLS} FROM devices WHERE account_id = ? ORDER BY created_at DESC`,
  )
    .bind(accountId)
    .all<DeviceRow>();
  return c.json({ devices: results.map(toSummary) });
});

app.get("/v1/devices/:id", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const row = await c.env.DB.prepare(
    `SELECT ${DEVICE_COLS} FROM devices WHERE id = ? AND account_id = ?`,
  )
    .bind(c.req.param("id"), accountId)
    .first<DeviceRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ device: toSummary(row) });
});

// Regenerate a pairing code for an existing device, so the parent can re-link the same device
// entry (e.g. after reinstalling the app on the phone). Resets the paired state and old token.
app.post("/v1/devices/:id/pair-code", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(id, accountId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  const pairCode = randomPairCode();
  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE devices
       SET pair_code = ?, pair_code_expires_at = ?, paired_at = NULL, device_token_hash = NULL
     WHERE id = ?`,
  )
    .bind(pairCode, new Date(now + PAIR_CODE_TTL_MS).toISOString(), id)
    .run();
  return c.json({ pairCode, pairCodeExpiresInMs: PAIR_CODE_TTL_MS });
});

// Delete a device and everything it reported (events + queued commands).
app.delete("/v1/devices/:id", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(id, accountId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM events WHERE device_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM commands WHERE device_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(id),
  ]);
  return c.json({ deleted: true });
});

// --- Pairing ----------------------------------------------------------------

app.post("/v1/pairing", async (c) => {
  const body = await c.req.json().catch(() => null);
  const pairCode = String(body?.pairCode ?? "");
  const deviceName = String(body?.deviceName ?? "").slice(0, 100);
  const platform = body?.platform;
  const appVersion = String(body?.appVersion ?? "");
  const consentAcceptedAt = String(body?.consentAcceptedAt ?? "");

  if (!pairCode || !deviceName || platform !== "android" || !appVersion) {
    return c.json({ error: "invalid_body" }, 400);
  }
  if (!consentAcceptedAt || Number.isNaN(new Date(consentAcceptedAt).getTime())) {
    return c.json({ error: "consent_required" }, 400);
  }

  const device = await c.env.DB.prepare(
    "SELECT id, pair_code_expires_at, paired_at FROM devices WHERE pair_code = ?",
  )
    .bind(pairCode)
    .first<{ id: string; pair_code_expires_at: string | null; paired_at: string | null }>();

  if (!device) return c.json({ error: "invalid_pair_code" }, 404);
  if (device.paired_at) return c.json({ error: "already_paired" }, 409);
  if (!device.pair_code_expires_at || new Date(device.pair_code_expires_at).getTime() < Date.now()) {
    return c.json({ error: "pair_code_expired" }, 410);
  }

  const token = randomToken();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE devices
       SET name = ?, platform = ?, app_version = ?, device_token_hash = ?,
           paired_at = ?, consent_accepted_at = ?, last_seen_at = ?,
           pair_code = NULL, pair_code_expires_at = NULL
     WHERE id = ?`,
  )
    .bind(deviceName, platform, appVersion, await hashToken(token), now, consentAcceptedAt, now, device.id)
    .run();

  return c.json({ deviceId: device.id, deviceToken: token }, 201);
});

// --- Events -----------------------------------------------------------------

async function authDevice(
  c: { req: { header: (n: string) => string | undefined }; env: Env },
): Promise<{ id: string; consent: string | null } | null> {
  const token = bearer(c.req.header("authorization"));
  if (!token) return null;
  const device = await c.env.DB.prepare(
    "SELECT id, consent_accepted_at FROM devices WHERE device_token_hash = ?",
  )
    .bind(await hashToken(token))
    .first<{ id: string; consent_accepted_at: string | null }>();
  return device ? { id: device.id, consent: device.consent_accepted_at } : null;
}

interface InEvent {
  kind: string;
  capturedAt: string;
  payload?: unknown;
  clientId?: string;
}

/** Insert one event, de-duplicating on clientId. Returns null for an unknown kind. */
async function insertEvent(
  env: Env,
  deviceId: string,
  e: InEvent,
  now: string,
): Promise<{ id: string; deduped: boolean } | null> {
  if (!EVENT_KINDS.includes(e.kind) || !e.capturedAt) return null;
  if (e.clientId) {
    const ex = await env.DB.prepare("SELECT id FROM events WHERE device_id = ? AND client_id = ?")
      .bind(deviceId, e.clientId)
      .first<{ id: string }>();
    if (ex) return { id: ex.id, deduped: true };
  }
  const sensitive = SENSITIVE_KINDS.has(e.kind);
  const stored = sensitive
    ? await encryptJson(e.payload, env.ANDSV_ENCRYPTION_KEY)
    : JSON.stringify(e.payload ?? null);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, device_id, kind, captured_at, received_at, payload, encrypted, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, deviceId, e.kind, e.capturedAt, now, stored, sensitive ? 1 : 0, e.clientId ?? null)
    .run();
  return { id, deduped: false };
}

app.post("/v1/events", async (c) => {
  const device = await authDevice(c);
  if (!device) return c.json({ error: "invalid_device_token" }, 401);
  if (!device.consent) return c.json({ error: "consent_not_recorded" }, 403);

  const body = await c.req.json().catch(() => null);
  const e: InEvent = {
    kind: String(body?.kind ?? ""),
    capturedAt: String(body?.capturedAt ?? ""),
    payload: body?.payload,
    clientId: typeof body?.clientId === "string" ? body.clientId : undefined,
  };
  const now = new Date().toISOString();
  const r = await insertEvent(c.env, device.id, e, now);
  if (!r) return c.json({ error: "invalid_body" }, 400);
  await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now, device.id).run();
  return c.json({ id: r.id, deduped: r.deduped }, 201);
});

// Offline sync: the monitored device flushes a batch of buffered events. Each is de-duplicated
// on its clientId, so re-sending after a dropped connection never stores anything twice.
app.post("/v1/events/batch", async (c) => {
  const device = await authDevice(c);
  if (!device) return c.json({ error: "invalid_device_token" }, 401);
  if (!device.consent) return c.json({ error: "consent_not_recorded" }, 403);

  const body = await c.req.json().catch(() => null);
  const list: unknown = body?.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > 200) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const now = new Date().toISOString();
  const ids: string[] = [];
  let stored = 0;
  for (const raw of list as Record<string, unknown>[]) {
    const e: InEvent = {
      kind: String(raw?.kind ?? ""),
      capturedAt: String(raw?.capturedAt ?? ""),
      payload: raw?.payload,
      clientId: typeof raw?.clientId === "string" ? raw.clientId : undefined,
    };
    const r = await insertEvent(c.env, device.id, e, now);
    if (!r) continue;
    ids.push(r.id);
    if (!r.deduped) stored += 1;
  }
  await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now, device.id).run();
  return c.json({ accepted: ids.length, stored, ids }, 201);
});

interface EventRow {
  id: string;
  kind: string;
  captured_at: string;
  received_at: string;
  payload: string;
  encrypted: number;
}

app.get("/v1/devices/:id/events", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const deviceId = c.req.param("id");

  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(deviceId, accountId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);

  const kind = c.req.query("kind");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 500);

  const stmt = kind
    ? c.env.DB.prepare(
        `SELECT id, kind, captured_at, received_at, payload, encrypted FROM events
           WHERE device_id = ? AND kind = ? ORDER BY captured_at DESC LIMIT ?`,
      ).bind(deviceId, kind, limit)
    : c.env.DB.prepare(
        `SELECT id, kind, captured_at, received_at, payload, encrypted FROM events
           WHERE device_id = ? ORDER BY captured_at DESC LIMIT ?`,
      ).bind(deviceId, limit);

  const { results } = await stmt.all<EventRow>();
  const key = c.env.ANDSV_ENCRYPTION_KEY;
  const events = await Promise.all(
    results.map(async (r) => ({
      id: r.id,
      deviceId,
      kind: r.kind,
      capturedAt: r.captured_at,
      receivedAt: r.received_at,
      payload: r.encrypted ? await decryptJson(r.payload, key) : JSON.parse(r.payload),
    })),
  );
  return c.json({ events });
});

// --- Watchlist --------------------------------------------------------------
// A term matches as a case-insensitive substring (so it hits even inside a word); numbers match
// on digits only. Matching runs over decrypted message/call payloads, grouped per chat/contact.

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

function eventMatchesTerm(kind: string, payload: unknown, term: string): boolean {
  const lower = term.trim().toLowerCase();
  if (!lower) return false;
  const digits = digitsOf(term);
  const p = (payload ?? {}) as Record<string, unknown>;
  const texts: unknown[] = [];
  const numbers: unknown[] = [];
  if (kind === "message") texts.push(p.text, p.sender, p.conversation, p.app);
  else if (kind === "call") {
    texts.push(p.name);
    numbers.push(p.number);
  }
  const textHit = texts.some((t) => typeof t === "string" && t.toLowerCase().includes(lower));
  const numHit =
    digits.length >= 3 && numbers.some((n) => typeof n === "string" && digitsOf(n).includes(digits));
  return textHit || numHit;
}

function watchGroupKey(kind: string, p: Record<string, unknown>): { key: string; title: string; app: string } {
  if (kind === "call") {
    const name = typeof p.name === "string" && p.name ? p.name : null;
    const number = typeof p.number === "string" && p.number ? p.number : null;
    return { key: `call:${name ?? number ?? "unknown"}`, title: name ?? number ?? "Unknown", app: "Calls" };
  }
  const app = typeof p.app === "string" ? p.app : "App";
  const conv =
    (typeof p.conversation === "string" && p.conversation) ||
    (typeof p.sender === "string" && p.sender) ||
    app;
  return { key: `msg:${app}:${conv}`, title: conv, app };
}

async function ownDeviceId(c: { req: { param: (n: string) => string; header: (n: string) => string | undefined }; env: Env }): Promise<string | null> {
  const accountId = await requireAccount(c);
  if (!accountId) return null;
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(id, accountId)
    .first();
  return owned ? id : null;
}

app.get("/v1/devices/:id/watch-terms", async (c) => {
  const deviceId = await ownDeviceId(c);
  if (!deviceId) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id, term, created_at FROM watch_terms WHERE device_id = ? ORDER BY created_at DESC",
  )
    .bind(deviceId)
    .all<{ id: string; term: string; created_at: string }>();
  return c.json({ terms: results.map((r) => ({ id: r.id, term: r.term, createdAt: r.created_at })) });
});

app.post("/v1/devices/:id/watch-terms", async (c) => {
  const deviceId = await ownDeviceId(c);
  if (!deviceId) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const term = String(body?.term ?? "").trim().slice(0, 100);
  if (!term) return c.json({ error: "invalid_body" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id, term, created_at FROM watch_terms WHERE device_id = ? AND term = ? COLLATE NOCASE",
  )
    .bind(deviceId, term)
    .first<{ id: string; term: string; created_at: string }>();
  if (existing) {
    return c.json({ term: { id: existing.id, term: existing.term, createdAt: existing.created_at } });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO watch_terms (id, device_id, term, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, deviceId, term, now)
    .run();
  return c.json({ term: { id, term, createdAt: now } }, 201);
});

app.delete("/v1/devices/:id/watch-terms/:termId", async (c) => {
  const deviceId = await ownDeviceId(c);
  if (!deviceId) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM watch_terms WHERE id = ? AND device_id = ?")
    .bind(c.req.param("termId"), deviceId)
    .run();
  return c.json({ deleted: true });
});

app.get("/v1/devices/:id/watch-matches", async (c) => {
  const deviceId = await ownDeviceId(c);
  if (!deviceId) return c.json({ error: "not_found" }, 404);
  const term = String(c.req.query("term") ?? "").trim().slice(0, 100);
  if (!term) return c.json({ error: "invalid_query" }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, captured_at, payload, encrypted FROM events
       WHERE device_id = ? AND kind IN ('message','call')
       ORDER BY captured_at DESC LIMIT 5000`,
  )
    .bind(deviceId)
    .all<EventRow>();

  const key = c.env.ANDSV_ENCRYPTION_KEY;
  const groups = new Map<string, { key: string; title: string; app: string; kind: string; matches: unknown[] }>();
  let total = 0;
  for (const r of results) {
    let payload: Record<string, unknown>;
    try {
      payload = (r.encrypted ? await decryptJson(r.payload, key) : JSON.parse(r.payload)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!eventMatchesTerm(r.kind, payload, term)) continue;
    total += 1;
    const g0 = watchGroupKey(r.kind, payload);
    let g = groups.get(g0.key);
    if (!g) {
      g = { key: g0.key, title: g0.title, app: g0.app, kind: r.kind, matches: [] };
      groups.set(g0.key, g);
    }
    g.matches.push({
      id: r.id,
      capturedAt: r.captured_at,
      kind: r.kind,
      direction: typeof payload.direction === "string" ? payload.direction : undefined,
      text: typeof payload.text === "string" ? payload.text : undefined,
      number: typeof payload.number === "string" ? payload.number : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      app: typeof payload.app === "string" ? payload.app : undefined,
    });
  }
  const out = [...groups.values()]
    .map((g) => ({ ...g, count: g.matches.length }))
    .sort((a, b) => {
      const am = a.matches[0] as { capturedAt: string };
      const bm = b.matches[0] as { capturedAt: string };
      return am.capturedAt < bm.capturedAt ? 1 : -1;
    });
  return c.json({ term, totalMatches: total, groups: out });
});

// --- App limits (rules) -----------------------------------------------------

// Parent sets which app packages are blocked on a device.
app.put("/v1/devices/:id/rules", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const deviceId = c.req.param("id");

  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(deviceId, accountId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const list = Array.isArray(body?.blockedApps) ? body.blockedApps : null;
  if (!list) return c.json({ error: "invalid_body" }, 400);
  const blocked = list.filter((x: unknown) => typeof x === "string").slice(0, 200);

  await c.env.DB.prepare("UPDATE devices SET blocked_apps = ? WHERE id = ?")
    .bind(JSON.stringify(blocked), deviceId)
    .run();
  return c.json({ blockedApps: blocked });
});

// The monitored device fetches its own block list.
app.get("/v1/rules", async (c) => {
  const token = bearer(c.req.header("authorization"));
  if (!token) return c.json({ error: "invalid_device_token" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT blocked_apps FROM devices WHERE device_token_hash = ?",
  )
    .bind(await hashToken(token))
    .first<{ blocked_apps: string | null }>();
  if (!row) return c.json({ error: "invalid_device_token" }, 401);
  return c.json({ blockedApps: parseBlocked(row.blocked_apps) });
});

// --- Remote commands (lock / unlock) ----------------------------------------

app.post("/v1/devices/:id/commands", async (c) => {
  const accountId = await requireAccount(c);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const deviceId = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(deviceId, accountId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const type = String(body?.type ?? "");
  if (type !== "lock" && type !== "unlock") return c.json({ error: "invalid_body" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO commands (id, device_id, type, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, deviceId, type, new Date().toISOString())
    .run();
  return c.json({ id, type }, 201);
});

app.get("/v1/commands", async (c) => {
  const token = bearer(c.req.header("authorization"));
  if (!token) return c.json({ error: "invalid_device_token" }, 401);
  const dev = await c.env.DB.prepare("SELECT id FROM devices WHERE device_token_hash = ?")
    .bind(await hashToken(token))
    .first<{ id: string }>();
  if (!dev) return c.json({ error: "invalid_device_token" }, 401);
  const { results } = await c.env.DB.prepare(
    "SELECT id, type FROM commands WHERE device_id = ? AND done_at IS NULL ORDER BY created_at ASC LIMIT 20",
  )
    .bind(dev.id)
    .all<{ id: string; type: string }>();
  return c.json({ commands: results });
});

app.post("/v1/commands/ack", async (c) => {
  const token = bearer(c.req.header("authorization"));
  if (!token) return c.json({ error: "invalid_device_token" }, 401);
  const dev = await c.env.DB.prepare("SELECT id FROM devices WHERE device_token_hash = ?")
    .bind(await hashToken(token))
    .first<{ id: string }>();
  if (!dev) return c.json({ error: "invalid_device_token" }, 401);
  const body = await c.req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 50)
    : [];
  const now = new Date().toISOString();
  for (const id of ids) {
    await c.env.DB.prepare("UPDATE commands SET done_at = ? WHERE id = ? AND device_id = ?")
      .bind(now, id, dev.id)
      .run();
  }
  return c.json({ acked: ids.length });
});

// --- Live screen relay (WebSocket) ------------------------------------------
// WebSocket clients can't set Authorization headers, so the token is a query param.

app.get("/v1/stream/source", async (c) => {
  const token = c.req.query("token") ?? "";
  const row = await c.env.DB.prepare("SELECT id FROM devices WHERE device_token_hash = ?")
    .bind(await hashToken(token))
    .first<{ id: string }>();
  if (!row) return c.json({ error: "unauthorized" }, 401);
  return relayFetch(c.env, row.id, "source", c.req.raw);
});

app.get("/v1/stream/viewer", async (c) => {
  const accountId = await verifyAccountToken(c.req.query("token") ?? "", c.env.ANDSV_JWT_SECRET);
  if (!accountId) return c.json({ error: "unauthorized" }, 401);
  const deviceId = c.req.query("deviceId") ?? "";
  const owned = await c.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
    .bind(deviceId, accountId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  return relayFetch(c.env, deviceId, "viewer", c.req.raw);
});

function relayFetch(env: Env, deviceId: string, role: string, req: Request): Promise<Response> {
  const stub = env.RELAY.get(env.RELAY.idFromName(deviceId));
  const url = new URL(req.url);
  url.searchParams.set("role", role);
  return stub.fetch(new Request(url.toString(), req));
}

// Everything that isn't an API route is served from the bundled dashboard.
// A path with no matching file falls back to index.html so the single-page app can route it.
app.all("*", (c) => {
  const path = new URL(c.req.url).pathname.replace(/^\/+/, "") || "index.html";
  const asset = ASSETS[path] ?? ASSETS["index.html"];
  return new Response(asset.body, { headers: { "content-type": asset.type } });
});

export default app;
