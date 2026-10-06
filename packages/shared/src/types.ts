// Response shapes returned by the API. Public types never carry exact locations or report text.

import type { CategoryId, Severity } from "./categories.ts";
import type { IncidentState, ModerationAction, PublicLabel } from "./rules.ts";
import type { ProximityBand } from "./schemas.ts";

/** [lng, lat] pairs, GeoJSON order. */
export type Ring = [number, number][];

export interface PublicIncident {
  id: string;
  categoryId: CategoryId;
  severity: Severity;
  label: PublicLabel;
  reportCount: number;
  /** Rounded to the minute. */
  firstReportedAt: string;
  lastReportAt: string;
  active: boolean;
  /** H3 cell shown to the public, at resolution 8 or 9. */
  cell: string;
  center: { lat: number; lng: number };
  boundary: Ring;
}

export interface MapResponse {
  incidents: PublicIncident[];
  generatedAt: string;
}

export interface ReportReceipt {
  reportId: string;
  /** Secret the app keeps to check this report's status later; shown only once. */
  statusToken: string;
  receivedAt: string;
}

export type ReportPublicStatus = "in_review" | "on_map" | "confirmed" | "closed" | "not_published";

export interface ReportStatus {
  reportId: string;
  status: ReportPublicStatus;
  reportCount: number;
  updatedAt: string;
}

export interface StaffUser {
  id: string;
  email: string;
  role: "moderator" | "admin";
}

export interface QueueItem {
  id: string;
  categoryId: CategoryId;
  severity: Severity;
  state: IncidentState;
  reportCount: number;
  independentReports: number;
  firstReportedAt: string;
  lastReportAt: string;
  publishAfter: string | null;
  cell: string;
  /** Milliseconds until the review target is missed; negative when overdue. */
  reviewDueInMs: number;
}

export interface ModeratorReport {
  id: string;
  receivedAt: string;
  occurredAt: string | null;
  channel: string;
  proximity: ProximityBand;
  description: string | null;
  /** Exact location, decrypted for moderators only. */
  location: { lat: number; lng: number; accuracyM: number | null };
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  reason: string | null;
}

export interface IncidentDetail extends QueueItem {
  publicLabel: PublicLabel | null;
  /** Community reactions from distinct phones. */
  confirmations: number;
  overVotes: number;
  falseVotes: number;
  reports: ModeratorReport[];
  audit: AuditEntry[];
  allowedActions: ModerationAction[];
}
