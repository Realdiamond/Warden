// Responders and channels (PRD modules 10 to 12): verified organisations see incidents in their
// area, post public updates, mark deployments, and send signed broadcasts.

import { z } from "zod";
import type { AlertTier } from "./alerts.ts";
import { isInNigeria } from "./distance.ts";

export const ORGANISATION_KINDS = [
  "police",
  "emergency",
  "health",
  "fire",
  "civil_defence",
  "road_safety",
  "community",
  "other",
] as const;
export type OrganisationKind = (typeof ORGANISATION_KINDS)[number];

/** What a responder can tell the public about an incident. */
export const UPDATE_KINDS = ["acknowledged", "responding", "on_scene", "resolved", "note"] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

export const UPDATE_TEXT: Record<Exclude<UpdateKind, "note">, string> = {
  acknowledged: "Seen by responders",
  responding: "Responders on the way",
  on_scene: "Responders on scene",
  resolved: "Closed by responders",
};

export const MAX_UPDATE_TEXT = 200;

export const IncidentUpdateSchema = z
  .strictObject({
    kind: z.enum(UPDATE_KINDS),
    /** Shown to the public; no names, plate numbers or exact addresses. */
    publicText: z.string().trim().max(MAX_UPDATE_TEXT).optional(),
  })
  .refine((u) => u.kind !== "note" || (u.publicText?.length ?? 0) > 0, {
    message: "A note needs text",
    path: ["publicText"],
  });
export type IncidentUpdateInput = z.output<typeof IncidentUpdateSchema>;

export const DEPLOYMENT_KINDS = [
  "patrol",
  "checkpoint",
  "ambulance",
  "fire_unit",
  "rescue",
  "other",
] as const;
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];

/**
 * Who sees a deployment. Public levels still show areas, never exact points: "street" is an
 * H3 cell of about 0.1 km², "area" one of about 5 km².
 */
export const DEPLOYMENT_VISIBILITY = [
  "public_street",
  "public_area",
  "responders",
  "hidden",
] as const;
export type DeploymentVisibility = (typeof DEPLOYMENT_VISIBILITY)[number];

const NigeriaPoint = z
  .strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .refine((p) => isInNigeria(p.lat, p.lng), "Must be in Nigeria");

export const DeploymentSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(DEPLOYMENT_KINDS),
  visibility: z.enum(DEPLOYMENT_VISIBILITY),
  location: NigeriaPoint,
  /** Up to 24 hours; ends on its own. */
  durationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60),
});
export type DeploymentInput = z.output<typeof DeploymentSchema>;

export const MAX_BROADCAST_MESSAGE = 280;
export const MAX_BROADCAST_RADIUS_M = 50_000;

export const BroadcastSchema = z.strictObject({
  tier: z.enum(["critical", "warning", "advisory"]),
  message: z.string().trim().min(10).max(MAX_BROADCAST_MESSAGE),
  center: NigeriaPoint,
  radiusM: z.number().int().min(500).max(MAX_BROADCAST_RADIUS_M),
  expiresInMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60),
});
export type BroadcastInput = z.output<typeof BroadcastSchema>;

export interface BroadcastPayload {
  id: string;
  organisation: string;
  tier: AlertTier;
  center: { lat: number; lng: number };
  radiusM: number;
  message: string;
  expiresAt: string;
}

/**
 * The exact bytes the server signs and phones verify (Ed25519). Any change to the message,
 * place, size, sender or expiry breaks the signature.
 */
export function broadcastSigningText(b: BroadcastPayload): string {
  return [
    "warden-broadcast-v1",
    b.id,
    b.organisation,
    b.tier,
    b.center.lat.toFixed(5),
    b.center.lng.toFixed(5),
    String(b.radiusM),
    b.expiresAt,
    b.message,
  ].join("\n");
}

export interface SignedBroadcast extends BroadcastPayload {
  keyId: string;
  /** Base64 Ed25519 signature over broadcastSigningText. */
  signature: string;
}

/** Deployments the public may see, as areas. */
export interface PublicPresence {
  id: string;
  kind: DeploymentKind;
  organisationKind: OrganisationKind;
  organisation: string;
  label: string;
  cell: string;
  center: { lat: number; lng: number };
  boundary: [number, number][];
  until: string;
}

export interface ResponderStatus {
  kind: UpdateKind;
  organisation: string;
  text: string;
  at: string;
}

export interface Organisation {
  id: string;
  name: string;
  kind: OrganisationKind;
}

export interface ResponderInboxItem {
  id: string;
  categoryId: string;
  severity: "critical" | "high" | "standard";
  state: string;
  label: string | null;
  reportCount: number;
  firstReportedAt: string;
  lastReportAt: string;
  center: { lat: number; lng: number };
  latestUpdate: ResponderStatus | null;
}

export interface ResponderDeployment {
  id: string;
  label: string;
  kind: DeploymentKind;
  visibility: DeploymentVisibility;
  location: { lat: number; lng: number };
  startsAt: string;
  endsAt: string;
  organisation: string;
  mine: boolean;
}

export interface SosBoardItem {
  sessionId: string;
  personName: string;
  startedAt: string;
  duress: boolean;
  lastPoint: { lat: number; lng: number; at: string; accuracyM: number | null } | null;
}
