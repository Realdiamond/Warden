// Community feed (M7): short safety tips from the public and notices from the Warden team,
// alongside official broadcasts. Adapted from the v1 "community feed" so that it cannot be used
// to name, shame or locate anyone:
// - tips are anonymous and are read by a moderator before anyone sees them;
// - a tip is tied to a coarse area (H3 resolution 7, a few kilometres across), never a point;
// - there are no replies or profiles; people can only flag a post, and enough flags hide it
//   until a moderator looks again.

import { z } from "zod";
import { isInNigeria } from "./distance.ts";

export const COMMUNITY_CELL_RESOLUTION = 7;
export const MAX_TIP_LENGTH = 280;
export const MIN_TIP_LENGTH = 10;
/** Flags from different phones that hide a published post until it is looked at again. */
export const FLAGS_TO_HIDE = 3;
/** How long a tip stays in the feed. */
export const TIP_LIFETIME_HOURS = 72;

export const POST_KINDS = ["tip", "notice"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const POST_STATES = ["pending", "published", "rejected", "removed"] as const;
export type PostState = (typeof POST_STATES)[number];

const InNigeria = z
  .object({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180) })
  .refine((p) => isInNigeria(p.lat, p.lng), { message: "The place must be in Nigeria" });

export const CommunityTipSchema = z.strictObject({
  body: z.string().trim().min(MIN_TIP_LENGTH).max(MAX_TIP_LENGTH),
  /** Used only to pick the area; the point itself is not stored. */
  location: InNigeria,
});
export type CommunityTip = z.input<typeof CommunityTipSchema>;

export const CommunityNoticeSchema = z.strictObject({
  body: z.string().trim().min(MIN_TIP_LENGTH).max(MAX_TIP_LENGTH),
  areaLabel: z.string().trim().min(2).max(60),
  center: InNigeria,
  hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14),
});
export type CommunityNotice = z.input<typeof CommunityNoticeSchema>;

export const POST_DECISIONS = ["publish", "reject", "remove"] as const;
export const PostDecisionSchema = z
  .strictObject({
    action: z.enum(POST_DECISIONS),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.action === "publish" || (d.reason?.length ?? 0) >= 3, {
    message: "A reason of at least 3 characters is required to reject or remove",
    path: ["reason"],
  });
export type PostDecision = z.input<typeof PostDecisionSchema>;

/** One item in the public feed. */
export interface CommunityPost {
  id: string;
  kind: PostKind | "broadcast";
  body: string;
  /** "Warden team", or the organisation for broadcasts; null for anonymous tips. */
  source: string | null;
  areaLabel: string | null;
  center: { lat: number; lng: number };
  publishedAt: string;
  expiresAt: string;
}

export interface CommunityFeedResponse {
  posts: CommunityPost[];
  generatedAt: string;
}

/** A tip waiting for a moderator. */
export interface ModeratorPost {
  id: string;
  kind: PostKind;
  state: PostState;
  body: string;
  center: { lat: number; lng: number };
  createdAt: string;
  flags: number;
  /** Things the moderator should look at before publishing. */
  warnings: string[];
}

const PHONE = /(?:\+?234|0)[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /https?:\/\/|www\./i;
const HANDLE = /(^|\s)@[a-z0-9_]{3,}/i;

/** Warnings shown to moderators; they still decide. */
export function tipWarnings(body: string): string[] {
  const warnings: string[] = [];
  if (PHONE.test(body)) warnings.push("Contains a phone number");
  if (EMAIL.test(body)) warnings.push("Contains an email address");
  if (LINK.test(body)) warnings.push("Contains a link");
  if (HANDLE.test(body)) warnings.push("Mentions a social media account");
  if (/\b(house|flat|plot|no\.?)\s*\d+/i.test(body)) warnings.push("May give an exact address");
  return warnings;
}
