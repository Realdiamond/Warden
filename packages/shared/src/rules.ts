// Publication and lifecycle rules from PRD module 3 ("When a report becomes public") and the
// report lifecycle diagram. Pure functions: the API applies them, tests pin them down.

import type { Category, Severity } from "./categories.ts";

export const INCIDENT_STATES = [
  "held",
  "unconfirmed",
  "verified",
  "disputed",
  "resolved",
  "removed",
  "merged",
] as const;

export type IncidentState = (typeof INCIDENT_STATES)[number];

/** States in which an incident can still absorb new reports. */
export const ACTIVE_STATES: readonly IncidentState[] = [
  "held",
  "unconfirmed",
  "verified",
  "disputed",
];

/** States the public map may show (still subject to category handling and publish time). */
export const PUBLIC_STATES: readonly IncidentState[] = [
  "unconfirmed",
  "verified",
  "disputed",
  "resolved",
];

export type ReporterTrust = "low" | "normal" | "high";

export type PublicLabel = "Unconfirmed" | "Corroborated" | "Verified" | "Disputed" | "Resolved";

/** Random publication delay for high and critical items, so timing cannot identify a reporter. */
export const PUBLISH_DELAY_MIN_MS = 2 * 60_000;
export const PUBLISH_DELAY_MAX_MS = 10 * 60_000;

/** How long an incident stays active without new reports before it resolves on its own. */
export const ACTIVE_TTL_MS: Record<Severity, number> = {
  standard: 6 * 3_600_000,
  high: 12 * 3_600_000,
  critical: 24 * 3_600_000,
};

/** Moderator review targets from the Trust and Safety section. */
export const REVIEW_SLA_MS: Record<Severity, number> = {
  critical: 5 * 60_000,
  high: 10 * 60_000,
  standard: 60 * 60_000,
};

export interface PublicationInput {
  category: Category;
  /** Reports from distinct devices about the same incident. */
  independentReports: number;
  reporterTrust: ReporterTrust;
}

export interface PublicationDecision {
  state: "held" | "unconfirmed";
  publishDelayMs: number;
  reason: string;
}

export function randomPublishDelay(random: () => number = Math.random): number {
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(PUBLISH_DELAY_MIN_MS + r * (PUBLISH_DELAY_MAX_MS - PUBLISH_DELAY_MIN_MS));
}

/**
 * Decides whether an incident built from citizen reports may go public, and when.
 * Moderator and agency decisions bypass this through {@link applyAction}.
 */
export function decidePublication(
  input: PublicationInput,
  random: () => number = Math.random,
): PublicationDecision {
  const { category, independentReports, reporterTrust } = input;

  if (category.handling === "private") {
    return { state: "held", publishDelayMs: 0, reason: "Private category: never shown on the map" };
  }

  if (category.severity === "standard") {
    return {
      state: "unconfirmed",
      publishDelayMs: 0,
      reason: "Standard severity: shown as unconfirmed",
    };
  }

  if (category.severity === "high") {
    if (independentReports >= 2 || reporterTrust === "high") {
      return {
        state: "unconfirmed",
        publishDelayMs: randomPublishDelay(random),
        reason: "High severity with corroboration or a high-trust reporter",
      };
    }
    return {
      state: "held",
      publishDelayMs: 0,
      reason: "High severity: needs corroboration or a moderator",
    };
  }

  // Critical: two independent sources, otherwise a moderator or agency must confirm.
  if (independentReports >= 2) {
    return {
      state: "unconfirmed",
      publishDelayMs: randomPublishDelay(random),
      reason: "Critical severity confirmed by two independent sources",
    };
  }
  return {
    state: "held",
    publishDelayMs: 0,
    reason: "Critical severity: needs a second source or a moderator",
  };
}

/**
 * When a new report merges into an existing incident, the incident may move from held to public.
 * It never moves backwards because of a new report, and moderator decisions are never overridden.
 */
export function stateAfterMerge(
  current: IncidentState,
  decision: PublicationDecision,
): IncidentState {
  if (current === "held" && decision.state === "unconfirmed") return "unconfirmed";
  return current;
}

export const MODERATION_ACTIONS = [
  "verify",
  "hold",
  "remove",
  "resolve",
  "dispute",
  "reopen",
] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

const TRANSITIONS: Record<ModerationAction, { from: readonly IncidentState[]; to: IncidentState }> =
  {
    verify: { from: ["held", "unconfirmed", "disputed"], to: "verified" },
    hold: { from: ["unconfirmed", "verified", "disputed"], to: "held" },
    remove: { from: ["held", "unconfirmed", "verified", "disputed", "resolved"], to: "removed" },
    resolve: { from: ["held", "unconfirmed", "verified", "disputed"], to: "resolved" },
    dispute: { from: ["unconfirmed", "verified"], to: "disputed" },
    reopen: { from: ["removed", "resolved"], to: "held" },
  };

export type ActionResult = { ok: true; state: IncidentState } | { ok: false; error: string };

export function applyAction(
  current: IncidentState,
  action: ModerationAction,
  category: Category,
): ActionResult {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    return { ok: false, error: `Cannot ${action} an incident that is ${current}` };
  }
  if (category.handling === "private" && (action === "verify" || action === "dispute")) {
    return { ok: false, error: "Private categories are never published" };
  }
  return { ok: true, state: rule.to };
}

export function isPubliclyVisible(state: IncidentState, category: Category): boolean {
  return category.handling === "public" && PUBLIC_STATES.includes(state);
}

export function publicLabel(state: IncidentState, independentReports: number): PublicLabel | null {
  switch (state) {
    case "verified":
      return "Verified";
    case "disputed":
      return "Disputed";
    case "resolved":
      return "Resolved";
    case "unconfirmed":
      return independentReports >= 2 ? "Corroborated" : "Unconfirmed";
    default:
      return null;
  }
}

/** Public precision by severity: H3 resolution 8 (about 0.74 km²) or 9 (about 0.1 km²). */
export function publicResolution(severity: Severity): 8 | 9 {
  return severity === "critical" ? 8 : 9;
}
