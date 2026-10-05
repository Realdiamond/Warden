import type { PublicLabel, ReportPublicStatus, Severity } from "@warden/shared";

export function timeAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#B42318",
  high: "#C2410C",
  standard: "#2563EB",
};

export const LABEL_EXPLANATION: Record<PublicLabel, string> = {
  Unconfirmed: "One report so far. Not yet confirmed.",
  Corroborated: "Reported by more than one person.",
  Verified: "Confirmed by Warden or a responder.",
  Disputed: "Some people say this is wrong. Being checked.",
  Resolved: "This is over.",
};

export const STATUS_TEXT: Record<ReportPublicStatus, string> = {
  in_review: "Being reviewed",
  on_map: "On the map",
  confirmed: "Confirmed",
  closed: "Closed",
  not_published: "Not published",
};
