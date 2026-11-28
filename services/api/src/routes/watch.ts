import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { requireAccount } from "../auth.ts";
import { decryptJson } from "../crypto.ts";

// --- Matching ---------------------------------------------------------------
// A watch term is matched as a case-insensitive substring (so a partial term catches it even
// inside a word), and numbers are matched on digits only (so "6475550192" catches "+1 647-555-0192").

export interface WatchMatch {
  id: string;
  capturedAt: string;
  kind: "message" | "call";
  direction?: string;
  text?: string;
  number?: string;
  name?: string;
  app?: string;
}

export function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

/** Does this decrypted message/call payload match the term? */
export function eventMatchesTerm(kind: string, payload: unknown, term: string): boolean {
  const lower = term.trim().toLowerCase();
  if (!lower) return false;
  const digits = digitsOf(term);
  const p = (payload ?? {}) as Record<string, unknown>;
  const texts: unknown[] = [];
  const numbers: unknown[] = [];
  if (kind === "message") {
    texts.push(p.text, p.sender, p.conversation, p.app);
  } else if (kind === "call") {
    texts.push(p.name);
    numbers.push(p.number);
  }
  const textHit = texts.some((t) => typeof t === "string" && t.toLowerCase().includes(lower));
  const numHit =
    digits.length >= 3 &&
    numbers.some((n) => typeof n === "string" && digitsOf(n).includes(digits));
  return textHit || numHit;
}

function groupKey(kind: string, p: Record<string, unknown>): { key: string; title: string; app: string } {
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

interface EventRow {
  id: string;
  kind: string;
  captured_at: string;
  payload: string;
  encrypted: number;
}

export function registerWatchRoutes(app: FastifyInstance): void {
  async function ownDevice(req: FastifyRequest, reply: FastifyReply, id: string) {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return null;
    const owned = db.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!owned) {
      reply.code(404).send({ error: "not_found" });
      return null;
    }
    return accountId;
  }

  // List watch terms for a device.
  app.get("/v1/devices/:id/watch-terms", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownDevice(req, reply, id))) return;
    const rows = db
      .prepare("SELECT id, term, created_at FROM watch_terms WHERE device_id = ? ORDER BY created_at DESC")
      .all(id) as { id: string; term: string; created_at: string }[];
    return reply.send({ terms: rows.map((r) => ({ id: r.id, term: r.term, createdAt: r.created_at })) });
  });

  // Add a watch term (name, number or keyword). Case-insensitive de-duplication.
  app.post("/v1/devices/:id/watch-terms", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownDevice(req, reply, id))) return;
    const parsed = z.object({ term: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const term = parsed.data.term;

    const existing = db
      .prepare("SELECT id, term, created_at FROM watch_terms WHERE device_id = ? AND term = ? COLLATE NOCASE")
      .get(id, term) as { id: string; term: string; created_at: string } | undefined;
    if (existing) {
      return reply.code(200).send({ term: { id: existing.id, term: existing.term, createdAt: existing.created_at } });
    }
    const termId = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO watch_terms (id, device_id, term, created_at) VALUES (?, ?, ?, ?)").run(
      termId,
      id,
      term,
      now,
    );
    return reply.code(201).send({ term: { id: termId, term, createdAt: now } });
  });

  // Remove a watch term.
  app.delete("/v1/devices/:id/watch-terms/:termId", async (req, reply) => {
    const { id, termId } = req.params as { id: string; termId: string };
    if (!(await ownDevice(req, reply, id))) return;
    db.prepare("DELETE FROM watch_terms WHERE id = ? AND device_id = ?").run(termId, id);
    return reply.send({ deleted: true });
  });

  // Return everything matching a term, grouped by chat / contact, newest first.
  app.get("/v1/devices/:id/watch-matches", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownDevice(req, reply, id))) return;
    const parsed = z.object({ term: z.string().trim().min(1).max(100) }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const term = parsed.data.term;

    // Scan the most recent messages/calls. Capped so a huge history can't make one request unbounded.
    const rows = db
      .prepare(
        `SELECT id, kind, captured_at, payload, encrypted FROM events
           WHERE device_id = ? AND kind IN ('message','call')
           ORDER BY captured_at DESC LIMIT 5000`,
      )
      .all(id) as unknown as EventRow[];

    const groups = new Map<
      string,
      { key: string; title: string; app: string; kind: string; matches: WatchMatch[] }
    >();
    let total = 0;

    for (const r of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = (r.encrypted ? decryptJson(r.payload) : JSON.parse(r.payload)) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!eventMatchesTerm(r.kind, payload, term)) continue;
      total += 1;
      const { key, title, app } = groupKey(r.kind, payload);
      let g = groups.get(key);
      if (!g) {
        g = { key, title, app, kind: r.kind, matches: [] };
        groups.set(key, g);
      }
      g.matches.push({
        id: r.id,
        capturedAt: r.captured_at,
        kind: r.kind as "message" | "call",
        direction: typeof payload.direction === "string" ? payload.direction : undefined,
        text: typeof payload.text === "string" ? payload.text : undefined,
        number: typeof payload.number === "string" ? payload.number : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        app: typeof payload.app === "string" ? payload.app : undefined,
      });
    }

    const out = [...groups.values()]
      .map((g) => ({ ...g, count: g.matches.length }))
      .sort((a, b) => (a.matches[0].capturedAt < b.matches[0].capturedAt ? 1 : -1));

    return reply.send({ term, totalMatches: total, groups: out });
  });
}
