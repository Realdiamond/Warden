import type { IncidentState, Severity } from "@warden/shared";
import { SEVERITY_LABEL, STATE_LABEL } from "../format.ts";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge severity-${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function StateBadge({ state }: { state: IncidentState }) {
  return <span className={`badge state-${state}`}>{STATE_LABEL[state]}</span>;
}
