import { INCIDENT_STATES, type IncidentState } from "@warden/shared";

export type Route =
  | { page: "queue"; state: IncidentState }
  | { page: "incident"; id: string }
  | { page: "r-incidents" }
  | { page: "r-incident"; id: string }
  | { page: "r-deployments" }
  | { page: "r-broadcasts" }
  | { page: "r-sos" };

const RESPONDER_PAGES = ["r-incidents", "r-deployments", "r-broadcasts", "r-sos"] as const;

export function parseRoute(hash: string): Route {
  const [, page, value] = hash.replace(/^#/, "").split("/");
  if (page === "incident" && value) return { page: "incident", id: decodeURIComponent(value) };
  if (page === "r-incident" && value) return { page: "r-incident", id: decodeURIComponent(value) };
  const responderPage = RESPONDER_PAGES.find((p) => p === page);
  if (responderPage) return { page: responderPage };
  const state = (value ?? "held") as IncidentState;
  return { page: "queue", state: INCIDENT_STATES.includes(state) ? state : "held" };
}

export function routeHref(route: Route): string {
  switch (route.page) {
    case "incident":
    case "r-incident":
      return `#/${route.page}/${encodeURIComponent(route.id)}`;
    case "queue":
      return `#/queue/${route.state}`;
    default:
      return `#/${route.page}`;
  }
}

export function isResponderRoute(route: Route): boolean {
  return route.page.startsWith("r-");
}
