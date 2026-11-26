// Shared contracts for Monitor. Owned here, used by every part — change rules here, not in the
// apps.

/**
 * Every signal a monitored phone reports is an "event" of one kind.
 */
export type EventKind =
  | "location" // where the phone is
  | "app_usage" // which app is in the foreground, for how long
  | "message" // message contents observed in a messaging app
  | "call" // call started/ended, number, direction, (optionally) audio ref
  | "screen" // a live-screen session marker
  | "control" // a remote-control session marker
  | "status"; // heartbeat / battery / app-health

export const EVENT_KINDS: readonly EventKind[] = [
  "location",
  "app_usage",
  "message",
  "call",
  "screen",
  "control",
  "status",
] as const;

export function isEventKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Sensitive kinds carry private content (what was said, exactly where someone is). Their payloads
 * are encrypted at rest and never returned in bulk list endpoints without an explicit reveal.
 */
const SENSITIVE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  "location",
  "message",
  "call",
]);

export function isSensitiveKind(kind: EventKind): boolean {
  return SENSITIVE_KINDS.has(kind);
}

// ---- Payload shapes -------------------------------------------------------

export interface LocationPayload {
  lat: number;
  lon: number;
  accuracyM?: number; // horizontal accuracy in metres
  speedMps?: number;
  battery?: number; // 0..1
}

export interface AppUsagePayload {
  packageName: string;
  appLabel?: string;
  foregroundMs: number;
  startedAt: string; // ISO
}

// Reported payloads are validated against these shapes at the edge (see services/api).

// ---- Pairing & consent ----------------------------------------------------

/**
 * What the monitored app must send to pair. `consentAcceptedAt` is required: the device is not
 * activated, and no events are accepted, until it is recorded.
 */
export interface PairRequest {
  pairCode: string;
  deviceName: string;
  platform: "android";
  appVersion: string;
  consentAcceptedAt: string; // ISO timestamp of the on-device agreement
}

export interface PairResponse {
  deviceId: string;
  deviceToken: string; // long-lived bearer the monitored app sends with every event
}

// ---- API DTOs -------------------------------------------------------------

export interface DeviceSummary {
  id: string;
  name: string | null;
  platform: string | null;
  pairedAt: string | null;
  consentAcceptedAt: string | null;
  lastSeenAt: string | null;
}

export interface EventEnvelope<P = unknown> {
  id: string;
  deviceId: string;
  kind: EventKind;
  capturedAt: string; // ISO, when it happened on the phone
  receivedAt: string; // ISO, when the server stored it
  payload: P;
}

export const PAIR_CODE_TTL_MS = 15 * 60 * 1000; // a pair code is valid for 15 minutes
