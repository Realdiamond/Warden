// Payload schemas shared by the API (validation) and the clients (typing and pre-checks).

import { z } from "zod";
import { CATEGORY_IDS } from "./categories.ts";
import { MODERATION_ACTIONS } from "./rules.ts";

export const PROXIMITY_BANDS = ["here", "near", "far", "unknown"] as const;
export type ProximityBand = (typeof PROXIMITY_BANDS)[number];

export const MAX_DESCRIPTION_LENGTH = 500;

export const LocationSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  accuracyM: z.number().nonnegative().max(50_000).optional(),
});
export type GeoPoint = z.infer<typeof LocationSchema>;

export const ReportSubmissionSchema = z.strictObject({
  categoryId: z.enum(CATEGORY_IDS),
  location: LocationSchema,
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
  proximity: z.enum(PROXIMITY_BANDS).default("unknown"),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type ReportSubmission = z.input<typeof ReportSubmissionSchema>;
export type ParsedReportSubmission = z.output<typeof ReportSubmissionSchema>;

export const TIME_WINDOWS = ["6h", "24h", "7d", "30d"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

/** The largest map area one request may cover, in degrees on each side. */
export const MAX_BBOX_SPAN_DEG = 6;

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export const BBoxSchema = z.string().transform((value, ctx): BBox => {
  const parts = value.split(",").map((part) => Number(part.trim()));
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (
    parts.length !== 4 ||
    minLng === undefined ||
    minLat === undefined ||
    maxLng === undefined ||
    maxLat === undefined ||
    parts.some((n) => !Number.isFinite(n))
  ) {
    ctx.addIssue({ code: "custom", message: "bbox must be minLng,minLat,maxLng,maxLat" });
    return z.NEVER;
  }
  if (
    minLng >= maxLng ||
    minLat >= maxLat ||
    minLat < -90 ||
    maxLat > 90 ||
    minLng < -180 ||
    maxLng > 180
  ) {
    ctx.addIssue({ code: "custom", message: "bbox corners are out of order or out of range" });
    return z.NEVER;
  }
  if (maxLng - minLng > MAX_BBOX_SPAN_DEG || maxLat - minLat > MAX_BBOX_SPAN_DEG) {
    ctx.addIssue({ code: "custom", message: `bbox may span at most ${MAX_BBOX_SPAN_DEG} degrees` });
    return z.NEVER;
  }
  return { minLng, minLat, maxLng, maxLat };
});

export const MapQuerySchema = z.object({
  bbox: BBoxSchema,
  window: z.enum(TIME_WINDOWS).default("24h"),
  categories: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((id) => id.trim())
            .filter((id): id is (typeof CATEGORY_IDS)[number] =>
              (CATEGORY_IDS as readonly string[]).includes(id),
            )
        : undefined,
    ),
});
export type MapQuery = z.output<typeof MapQuerySchema>;

export const ModerationDecisionSchema = z
  .strictObject({
    action: z.enum(MODERATION_ACTIONS),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (decision) =>
      (decision.action !== "remove" && decision.action !== "hold") ||
      (decision.reason?.length ?? 0) >= 3,
    {
      message: "A reason of at least 3 characters is required to hold or remove",
      path: ["reason"],
    },
  );
export type ModerationDecision = z.output<typeof ModerationDecisionSchema>;

export const StaffLoginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
export type StaffLogin = z.output<typeof StaffLoginSchema>;

/** Password rule for new staff accounts. */
export const MIN_STAFF_PASSWORD_LENGTH = 14;
