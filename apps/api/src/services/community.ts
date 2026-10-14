// Community feed (M7, see packages/shared/src/community.ts and ADR 0007). Anonymous tips wait
// for a moderator; Warden team notices go out at once. Every staff decision is audited.

import { randomUUID } from "node:crypto";
import {
  type BBox,
  type CommunityNotice,
  type CommunityPost,
  type CommunityTip,
  FLAGS_TO_HIDE,
  type ModeratorPost,
  type PostDecision,
  type PostKind,
  type PostState,
  type StaffUser,
  TIP_LIFETIME_HOURS,
  tipWarnings,
} from "@warden/shared";
import { cellCenter, cellsFor } from "@warden/shared/geo";
import { withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

const HOUR = 3_600_000;
const FEED_LIMIT = 50;

function areaOf(location: { lat: number; lng: number }) {
  // COMMUNITY_CELL_RESOLUTION is 7.
  const cell = cellsFor(location.lat, location.lng).r7;
  return { cell, center: cellCenter(cell) };
}

/** Stores an anonymous tip for review. Only the coarse area is kept, never the point. */
export async function submitTip(deps: ServiceDeps, tip: CommunityTip): Promise<{ id: string }> {
  const now = deps.now();
  const { cell, center } = areaOf(tip.location);
  const id = randomUUID();
  await deps.pool.query(
    `INSERT INTO community_posts
       (id, kind, state, cell, center_lat, center_lng, body_enc, key_id, created_at, expires_at)
     VALUES ($1, 'tip', 'pending', $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      cell,
      center.lat,
      center.lng,
      deps.cipher.encrypt("community.body", tip.body.trim()),
      deps.cipher.currentKeyId,
      now,
      new Date(now.getTime() + TIP_LIFETIME_HOURS * HOUR),
    ],
  );
  return { id };
}

interface PostRow {
  id: string;
  kind: PostKind;
  state: PostState;
  center_lat: number;
  center_lng: number;
  area_label: string | null;
  body_enc: Buffer;
  key_id: string;
  created_at: Date;
  published_at: Date | null;
  expires_at: Date;
  flags: number;
}

/** Published posts and live broadcasts in a map area, newest first. */
export async function communityFeed(deps: ServiceDeps, bbox: BBox): Promise<CommunityPost[]> {
  const now = deps.now();
  const posts = await deps.pool.query<PostRow>(
    `SELECT * FROM community_posts
      WHERE state = 'published' AND expires_at > $1
        AND center_lat BETWEEN $2 AND $3 AND center_lng BETWEEN $4 AND $5
      ORDER BY published_at DESC LIMIT $6`,
    [now, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, FEED_LIMIT],
  );
  const broadcasts = await deps.pool.query<{
    id: string;
    message: string;
    lat: number;
    lng: number;
    created_at: Date;
    expires_at: Date;
    organisation: string;
  }>(
    `SELECT b.id, b.message, b.lat, b.lng, b.created_at, b.expires_at, o.name AS organisation
       FROM broadcasts b JOIN organisations o ON o.id = b.organisation_id
      WHERE b.withdrawn_at IS NULL AND b.expires_at > $1
        AND b.lat BETWEEN $2 AND $3 AND b.lng BETWEEN $4 AND $5
      ORDER BY b.created_at DESC LIMIT $6`,
    [now, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, FEED_LIMIT],
  );
  const items: CommunityPost[] = [
    ...posts.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      body: deps.cipher.decrypt("community.body", row.key_id, row.body_enc),
      source: row.kind === "notice" ? "Warden team" : null,
      areaLabel: row.area_label,
      center: { lat: row.center_lat, lng: row.center_lng },
      publishedAt: (row.published_at ?? row.created_at).toISOString(),
      expiresAt: row.expires_at.toISOString(),
    })),
    ...broadcasts.rows.map((row) => ({
      id: row.id,
      kind: "broadcast" as const,
      body: row.message,
      source: row.organisation,
      areaLabel: null,
      center: { lat: row.lat, lng: row.lng },
      publishedAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    })),
  ];
  return items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, FEED_LIMIT);
}

/**
 * One flag per phone. Enough flags hide the post until a moderator looks again. Returns false
 * for posts that are not in the feed, so hidden posts look the same as missing ones.
 */
export async function flagPost(
  deps: ServiceDeps,
  postId: string,
  installId: string,
): Promise<boolean> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<{ state: PostState; flags: number }>(
      "SELECT state, flags FROM community_posts WHERE id = $1 AND expires_at > $2 FOR UPDATE",
      [postId, now],
    );
    const row = rows[0];
    if (row?.state !== "published") return false;
    const inserted = await client.query(
      `INSERT INTO community_post_flags (post_id, device_tag, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [postId, deps.hasher.hmac("device-post-flag", installId, postId), now],
    );
    if (!inserted.rowCount) return true;
    const flags = row.flags + 1;
    const hide = flags >= FLAGS_TO_HIDE;
    await client.query("UPDATE community_posts SET flags = $2, state = $3 WHERE id = $1", [
      postId,
      flags,
      hide ? "pending" : "published",
    ]);
    if (hide) {
      await appendAudit(client, {
        at: now,
        actorType: "system",
        actorId: "community-flags",
        action: "community_post.hidden",
        objectType: "community_post",
        objectId: postId,
        details: { flags },
      });
    }
    return true;
  });
}

/** Tips waiting for a decision, including published posts hidden by flags. Oldest first. */
export async function postQueue(deps: ServiceDeps): Promise<ModeratorPost[]> {
  const { rows } = await deps.pool.query<PostRow>(
    `SELECT * FROM community_posts WHERE state = 'pending' AND expires_at > $1
      ORDER BY created_at LIMIT 100`,
    [deps.now()],
  );
  return rows.map((row) => {
    const body = deps.cipher.decrypt("community.body", row.key_id, row.body_enc);
    const warnings = tipWarnings(body);
    if (row.flags >= FLAGS_TO_HIDE) warnings.unshift(`Hidden after ${row.flags} people flagged it`);
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      body,
      center: { lat: row.center_lat, lng: row.center_lng },
      createdAt: row.created_at.toISOString(),
      flags: row.flags,
      warnings,
    };
  });
}

export type PostOutcome =
  | { ok: true; state: PostState }
  | { ok: false; status: 404 | 409; message: string };

export async function decidePost(
  deps: ServiceDeps,
  staff: StaffUser,
  postId: string,
  decision: PostDecision,
): Promise<PostOutcome> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<{ state: PostState; published_at: Date | null }>(
      "SELECT state, published_at FROM community_posts WHERE id = $1 FOR UPDATE",
      [postId],
    );
    const row = rows[0];
    if (!row) return { ok: false, status: 404, message: "Post not found." };
    const allowed =
      decision.action === "remove"
        ? row.state === "published" || row.state === "pending"
        : row.state === "pending";
    if (!allowed) return { ok: false, status: 409, message: `This post is already ${row.state}.` };
    const state: PostState =
      decision.action === "publish"
        ? "published"
        : decision.action === "reject"
          ? "rejected"
          : "removed";
    await client.query(
      `UPDATE community_posts
          SET state = $2, decided_by = $3, decided_at = $4,
              published_at = CASE WHEN $2 = 'published' THEN coalesce(published_at, $4) ELSE published_at END
        WHERE id = $1`,
      [postId, state, staff.id, now],
    );
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: `community_post.${decision.action}`,
      objectType: "community_post",
      objectId: postId,
      reason: decision.reason ?? null,
    });
    return { ok: true, state };
  });
}

/** A notice from the Warden team, published at once. */
export async function createNotice(
  deps: ServiceDeps,
  staff: StaffUser,
  notice: CommunityNotice,
): Promise<{ id: string }> {
  const now = deps.now();
  const { cell, center } = areaOf(notice.center);
  const id = randomUUID();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO community_posts
         (id, kind, state, cell, center_lat, center_lng, area_label, body_enc, key_id, created_by,
          created_at, published_at, expires_at, decided_by, decided_at)
       VALUES ($1, 'notice', 'published', $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $8, $9)`,
      [
        id,
        cell,
        center.lat,
        center.lng,
        notice.areaLabel.trim(),
        deps.cipher.encrypt("community.body", notice.body.trim()),
        deps.cipher.currentKeyId,
        staff.id,
        now,
        new Date(now.getTime() + notice.hours * HOUR),
      ],
    );
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "community_post.notice",
      objectType: "community_post",
      objectId: id,
      details: { areaLabel: notice.areaLabel.trim(), hours: notice.hours },
    });
  });
  return { id };
}
