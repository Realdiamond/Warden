// News leads (M8). Adapted from the v1 "news scraping": Warden reads the public RSS or Atom
// feeds of outlets the operator lists (no scraping of pages), keeps only items that mention a
// covered area and a kind of incident, and puts them in front of a moderator. Nothing from the
// news reaches the map unless a moderator adds it, and the incident links to the article.

import { randomUUID } from "node:crypto";
import {
  ACTIVE_TTL_MS,
  type CategoryId,
  getCategory,
  type NewsLead,
  type StaffUser,
} from "@warden/shared";
import { cellCenter, cellsFor } from "@warden/shared/geo";
import { withTransaction } from "../db/pool.ts";
import { USSD_REGIONS } from "../ussd/areas.ts";
import { loadIncidentForAlert, recordIncidentAlert } from "./alerts.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

export interface FeedItem {
  title: string;
  link: string;
  summary: string | null;
  publishedAt: Date | null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function clean(raw: string | undefined): string {
  if (!raw) return "";
  return (
    raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      // Feeds often escape the HTML inside descriptions, so decode before removing tags.
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
        if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
        if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
        return ENTITIES[code.toLowerCase()] ?? match;
      })
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1];
}

/** Reads RSS 2.0 items or Atom entries. Small and forgiving; no XML library needed. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1] ?? "");
  return blocks.flatMap((block) => {
    const title = clean(tag(block, "title"));
    const link =
      clean(tag(block, "link")) || (/<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? "").trim();
    if (!title || !/^https?:\/\//.test(link)) return [];
    const date = clean(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated"));
    const parsed = date ? new Date(date) : null;
    const summary = clean(tag(block, "description") ?? tag(block, "summary")).slice(0, 500);
    return [
      {
        title: title.slice(0, 300),
        link: link.slice(0, 1000),
        summary: summary || null,
        publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      },
    ];
  });
}

/** Words that point to a kind of incident. Private categories are never taken from the news. */
const KEYWORDS: Array<[RegExp, CategoryId]> = [
  [/\bkidnap/i, "kidnapping"],
  [/\bbandit/i, "bandit_attack"],
  [/\bcult(ist|ists|s)?\b|\bcult clash/i, "cult_clash"],
  [/\barmed robber|\brobbers?\b|\brobbed\b/i, "armed_robbery"],
  [/\bone[- ]chance\b/i, "one_chance"],
  [/\bgun(fire|shots?)\b/i, "gunfire_heard"],
  [/\bgunmen\b|\bshot dead\b|\bshooting\b/i, "shooting"],
  [/\bexplosion\b|\bblast\b/i, "explosion"],
  [/\btanker\b/i, "tanker_incident"],
  [/\bbuilding collapse|\bcollapsed? building|\bbuilding (has )?collapsed/i, "building_collapse"],
  [/\bflood/i, "flood"],
  [/\bgas leak/i, "gas_leak"],
  [/\bfire\b|\binferno\b|\bablaze\b/i, "fire"],
  [/\bcommunal clash|\bclash(es)? between\b/i, "communal_clash"],
  [/\briot/i, "riot"],
  [/\bprotest/i, "protest"],
  [/\bfake (police|officers?|soldiers?)\b|\bimpersonat/i, "fake_officials"],
  [/\bcrash\b|\baccident\b/i, "crash"],
];

export function categoryFromText(text: string): CategoryId | null {
  for (const [pattern, category] of KEYWORDS) {
    if (pattern.test(text) && getCategory(category)?.handling === "public") return category;
  }
  return null;
}

/** Well-known places beyond the local government areas, with approximate centres. */
const EXTRA_PLACES = [
  { name: "Lekki", lat: 6.44, lng: 3.53 },
  { name: "Victoria Island", lat: 6.428, lng: 3.421 },
  { name: "Ikoyi", lat: 6.45, lng: 3.435 },
  { name: "Yaba", lat: 6.515, lng: 3.378 },
  { name: "Ojota", lat: 6.585, lng: 3.38 },
  { name: "Maryland", lat: 6.571, lng: 3.367 },
  { name: "Ojodu", lat: 6.64, lng: 3.36 },
  { name: "Festac", lat: 6.467, lng: 3.283 },
  { name: "Wuse", lat: 9.07, lng: 7.47 },
  { name: "Garki", lat: 9.03, lng: 7.49 },
  { name: "Maitama", lat: 9.085, lng: 7.5 },
  { name: "Kubwa", lat: 9.15, lng: 7.33 },
  { name: "Nyanya", lat: 9.0, lng: 7.57 },
];

const PLACES = [...EXTRA_PLACES, ...USSD_REGIONS.flatMap((r) => r.areas)].sort(
  (a, b) => b.name.length - a.name.length,
);

export function placeFromText(text: string): { name: string; lat: number; lng: number } | null {
  for (const place of PLACES) {
    const escaped = place.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return place;
  }
  return null;
}

const MAX_AGE_MS = 3 * 86_400_000;
const MAX_FEED_BYTES = 2_000_000;

export interface NewsSource {
  name: string;
  url: string;
}

/** "Name|https://...,Name|https://..." */
export function parseNewsSources(value: string | undefined): NewsSource[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [name, url] = entry.split("|").map((s) => s.trim());
      return name && url && /^https:\/\//.test(url) ? [{ name, url }] : [];
    });
}

/** Saves new leads from the given feed items. Returns how many were added. */
export async function saveLeads(
  deps: Pick<ServiceDeps, "pool" | "now">,
  source: string,
  items: FeedItem[],
): Promise<number> {
  const now = deps.now();
  let added = 0;
  for (const item of items) {
    if (item.publishedAt && now.getTime() - item.publishedAt.getTime() > MAX_AGE_MS) continue;
    const text = `${item.title} ${item.summary ?? ""}`;
    const category = categoryFromText(text);
    const place = placeFromText(text);
    if (!category || !place) continue;
    const result = await deps.pool.query(
      `INSERT INTO news_leads
         (id, source, url, title, summary, published_at, category_id, place, lat, lng, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (url) DO NOTHING`,
      [
        randomUUID(),
        source,
        item.link,
        item.title,
        item.summary,
        item.publishedAt,
        category,
        place.name,
        place.lat,
        place.lng,
        now,
      ],
    );
    added += result.rowCount ?? 0;
  }
  return added;
}

export async function fetchNews(
  deps: Pick<ServiceDeps, "pool" | "now">,
  sources: NewsSource[],
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number | string>> {
  const result: Record<string, number | string> = {};
  for (const source of sources) {
    try {
      const response = await fetchImpl(source.url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": "WardenNewsBot/1.0 (+https://warden.ng)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > MAX_FEED_BYTES) throw new Error("feed too large");
      result[source.name] = await saveLeads(deps, source.name, parseFeed(body));
    } catch (err) {
      result[source.name] = err instanceof Error ? err.message : "failed";
    }
  }
  return result;
}

interface LeadRow {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: Date | null;
  category_id: CategoryId | null;
  place: string | null;
  created_at: Date;
}

export async function newsQueue(deps: ServiceDeps): Promise<NewsLead[]> {
  const { rows } = await deps.pool.query<LeadRow>(
    `SELECT id, source, url, title, summary, published_at, category_id, place, created_at
       FROM news_leads WHERE state = 'new' ORDER BY created_at DESC LIMIT 100`,
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    url: row.url,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at?.toISOString() ?? null,
    categoryId: row.category_id,
    place: row.place,
    createdAt: row.created_at.toISOString(),
  }));
}

export type LeadOutcome =
  | { ok: true; incidentId: string | null }
  | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * Adds a lead to the map as an unconfirmed incident in the area it names, or dismisses it.
 * The incident is placed at the area (H3 resolution 7), never a street.
 */
export async function decideLead(
  deps: ServiceDeps,
  staff: StaffUser,
  leadId: string,
  decision: { action: "add" | "dismiss"; categoryId?: CategoryId; reason?: string },
): Promise<LeadOutcome> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<LeadRow & { state: string; lat: number; lng: number }>(
      "SELECT * FROM news_leads WHERE id = $1 FOR UPDATE",
      [leadId],
    );
    const lead = rows[0];
    if (!lead) return { ok: false, status: 404, message: "Lead not found." };
    if (lead.state !== "new") return { ok: false, status: 409, message: "Already decided." };

    if (decision.action === "dismiss") {
      await client.query(
        "UPDATE news_leads SET state = 'dismissed', decided_by = $2, decided_at = $3 WHERE id = $1",
        [leadId, staff.id, now],
      );
      await appendAudit(client, {
        at: now,
        actorType: "staff",
        actorId: staff.id,
        action: "news_lead.dismiss",
        objectType: "news_lead",
        objectId: leadId,
        reason: decision.reason ?? null,
      });
      return { ok: true, incidentId: null };
    }

    const category = getCategory(decision.categoryId ?? lead.category_id ?? "");
    const publicCategory = category?.handling === "public" ? category : null;
    if (!publicCategory) {
      return { ok: false, status: 400, message: "Choose a public kind of incident." };
    }
    const cell = cellsFor(lead.lat, lead.lng).r7;
    const center = cellCenter(cell);
    const incidentId = randomUUID();
    await client.query(
      `INSERT INTO incidents
         (id, category_id, severity, handling, state, public_cell, public_point, match_cell,
          report_count, independent_reports, first_reported_at, last_report_at, publish_after,
          active_until, source, source_ref, created_at, updated_at)
       VALUES ($1, $2, $3, 'public', 'unconfirmed', $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
               $7, 0, 1, $8, $8, $8, $9, 'news', $10, $8, $8)`,
      [
        incidentId,
        publicCategory.id,
        publicCategory.severity,
        cell,
        center.lng,
        center.lat,
        cellsFor(lead.lat, lead.lng).r9,
        now,
        new Date(now.getTime() + ACTIVE_TTL_MS[publicCategory.severity]),
        lead.url,
      ],
    );
    await client.query(
      `UPDATE news_leads SET state = 'added', incident_id = $2, decided_by = $3, decided_at = $4
        WHERE id = $1`,
      [leadId, incidentId, staff.id, now],
    );
    const incident = await loadIncidentForAlert(client, incidentId);
    if (incident) await recordIncidentAlert(client, incident, "new", now, now);
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "news_lead.add",
      objectType: "incident",
      objectId: incidentId,
      details: { lead: leadId, url: lead.url, categoryId: publicCategory.id },
    });
    return { ok: true, incidentId };
  });
}
