import type { IncidentState, ModerationAction, Severity } from "@warden/shared";

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "due in 4 min" or "overdue by 12 min". */
export function reviewDue(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const span = minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
  return ms >= 0 ? `due in ${span}` : `overdue by ${span}`;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  standard: "Standard",
};

export const STATE_LABEL: Record<IncidentState, string> = {
  held: "Held",
  unconfirmed: "Unconfirmed",
  verified: "Verified",
  disputed: "Disputed",
  resolved: "Resolved",
  removed: "Removed",
  merged: "Merged",
};

export const ACTION_LABEL: Record<ModerationAction, string> = {
  verify: "Verify and publish",
  hold: "Hold",
  remove: "Remove",
  resolve: "Mark resolved",
  dispute: "Mark disputed",
  reopen: "Reopen",
};

/** Actions that need a written reason before they are sent. */
export const NEEDS_REASON: ReadonlySet<ModerationAction> = new Set(["hold", "remove"]);

export function formatCoordinate(value: number): string {
  return value.toFixed(5);
}
