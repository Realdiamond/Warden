// Trip sharing and SOS (PRD modules 8 and 9, Phase 1: trusted contacts only). A session is
// started from the phone; contacts follow it through a private link that carries a secret
// token. Exact locations go only to holders of that link, never to any public endpoint.

import { z } from "zod";
import { isInNigeria } from "./distance.ts";

export const SESSION_KINDS = ["trip", "sos"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATES = ["active", "overdue", "ended"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const SESSION_OUTCOMES = ["arrived", "safe", "cancelled", "expired"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

export const MAX_CONTACTS = 5;
export const MAX_PERSON_NAME = 40;
export const MAX_SESSION_NOTE = 200;
/** A trip may be planned up to this far ahead. */
export const MAX_TRIP_MS = 12 * 3_600_000;
/** Every session stops on its own after a day. */
export const SESSION_MAX_MS = 24 * 3_600_000;
/** How late a trip can be before contacts are told. */
export const OVERDUE_GRACE_MS = 10 * 60_000;
/** Locations and messages are deleted this long after a session ends. */
export const SESSION_RETENTION_MS = 48 * 3_600_000;
export const MAX_POINTS_PER_UPLOAD = 50;
export const MAX_EXTEND_MINUTES = 240;

/**
 * Normalises a Nigerian mobile number to +234XXXXXXXXXX. Accepts 0803..., 234803... and
 * +234803..., with spaces or dashes. Returns null for anything else.
 */
export function normalizeNigerianPhone(value: string): string | null {
  const digits = value.replace(/[\s()-]/g, "");
  let national: string | null = null;
  if (/^0[789][01]\d{8}$/.test(digits)) national = digits.slice(1);
  else if (/^\+?234[789][01]\d{8}$/.test(digits)) national = digits.replace(/^\+?234/, "");
  return national ? `+234${national}` : null;
}

export const PhoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizeNigerianPhone(value);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Enter a Nigerian mobile number, like 0803 123 4567" });
    return z.NEVER;
  }
  return phone;
});

export const ContactSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_PERSON_NAME),
  phone: PhoneSchema,
});
export type Contact = z.output<typeof ContactSchema>;

const DestinationSchema = z
  .strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().trim().max(60).optional(),
  })
  .refine((p) => isInNigeria(p.lat, p.lng), "Warden works in Nigeria only for now");

export const SessionStartSchema = z
  .strictObject({
    kind: z.enum(SESSION_KINDS),
    personName: z.string().trim().min(1).max(MAX_PERSON_NAME),
    contacts: z
      .array(ContactSchema)
      .max(MAX_CONTACTS)
      .default([])
      .refine(
        (list) => new Set(list.map((c) => c.phone)).size === list.length,
        "Each contact must have a different number",
      ),
    destination: DestinationSchema.optional(),
    expectedArrivalAt: z.iso.datetime().optional(),
    note: z.string().trim().max(MAX_SESSION_NOTE).optional(),
  })
  .refine((s) => s.kind === "sos" || s.expectedArrivalAt !== undefined, {
    message: "A trip needs an expected arrival time",
    path: ["expectedArrivalAt"],
  });
export type SessionStart = z.output<typeof SessionStartSchema>;

export const SessionPointsSchema = z.strictObject({
  points: z
    .array(
      z.strictObject({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000).optional(),
        at: z.iso.datetime(),
        battery: z.number().int().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(MAX_POINTS_PER_UPLOAD),
});
export type SessionPoint = z.output<typeof SessionPointsSchema>["points"][number];

export const SessionEndSchema = z.strictObject({
  outcome: z.enum(["arrived", "safe", "cancelled"]),
  /** Set when the person entered their duress PIN: the phone looks stopped, contacts are alarmed. */
  duress: z.boolean().default(false),
});

export const SessionExtendSchema = z.strictObject({
  minutes: z.number().int().min(5).max(MAX_EXTEND_MINUTES),
});

export interface SessionReceipt {
  sessionId: string;
  /** Goes in the link for contacts. Shown only once. */
  viewToken: string;
  /** Lets this phone update and end the session. Never shared. */
  controlToken: string;
  /** Link for contacts, when the server knows its public address. */
  viewUrl: string | null;
  expiresAt: string;
}

export interface SessionView {
  kind: SessionKind;
  state: SessionState;
  /** True when contacts should act now: SOS, overdue trip, or duress. */
  alarm: boolean;
  duress: boolean;
  personName: string;
  note: string | null;
  destination: { lat: number; lng: number; label?: string } | null;
  expectedArrivalAt: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: SessionOutcome | null;
  lastPoint: {
    lat: number;
    lng: number;
    accuracyM: number | null;
    at: string;
    battery: number | null;
  } | null;
  /** [lng, lat] pairs, oldest first. */
  track: [number, number][];
}

/** The link fragment is never sent to any server, so the token stays out of logs. */
export function viewLink(baseUrl: string, sessionId: string, viewToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/live#${sessionId}.${viewToken}`;
}

export function parseViewFragment(hash: string): { sessionId: string; viewToken: string } | null {
  const match = /^#?([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(hash);
  return match?.[1] && match[2] ? { sessionId: match[1], viewToken: match[2] } : null;
}
