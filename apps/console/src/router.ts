import { INCIDENT_STATES, type IncidentState } from "@warden/shared";

export type Route = { page: "queue"; state: IncidentState } | { page: "incident"; id: string };

export function parseRoute(hash: string): Route {
  const [, page, value] = hash.replace(/^#/, "").split("/");
  if (page === "incident" && value) return { page: "incident", id: decodeURIComponent(value) };
  const state = (value ?? "held") as IncidentState;
  return { page: "queue", state: INCIDENT_STATES.includes(state) ? state : "held" };
}

export function routeHref(route: Route): string {
  return route.page === "incident"
    ? `#/incident/${encodeURIComponent(route.id)}`
    : `#/queue/${route.state}`;
}
