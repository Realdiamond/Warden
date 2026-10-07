import type { StaffUser } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, setUnauthorizedListener } from "./api.ts";
import { IncidentPage } from "./pages/IncidentPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { QueuePage } from "./pages/QueuePage.tsx";
import { BroadcastsPage } from "./responder/BroadcastsPage.tsx";
import { DeploymentsPage } from "./responder/DeploymentsPage.tsx";
import { ResponderInboxPage } from "./responder/ResponderInboxPage.tsx";
import { ResponderIncidentPage } from "./responder/ResponderIncidentPage.tsx";
import { SosBoardPage } from "./responder/SosBoardPage.tsx";
import { isResponderRoute, parseRoute, type Route, routeHref } from "./router.ts";

const RESPONDER_NAV: { route: Route; label: string }[] = [
  { route: { page: "r-incidents" }, label: "Incidents" },
  { route: { page: "r-sos" }, label: "SOS" },
  { route: { page: "r-deployments" }, label: "Deployments" },
  { route: { page: "r-broadcasts" }, label: "Broadcasts" },
];

function ResponderContent({ route }: { route: Route }) {
  switch (route.page) {
    case "r-incident":
      return <ResponderIncidentPage id={route.id} />;
    case "r-deployments":
      return <DeploymentsPage />;
    case "r-broadcasts":
      return <BroadcastsPage />;
    case "r-sos":
      return <SosBoardPage />;
    default:
      return <ResponderInboxPage />;
  }
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const [user, setUser] = useState<StaffUser | null | "loading">("loading");
  const route = useRoute();

  useEffect(() => {
    setUnauthorizedListener(() => setUser(null));
    api
      .me()
      .then(setUser)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status === 401) setUser(null);
      });
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  if (user === "loading") return <p className="page-message">Loading…</p>;
  if (!user) return <LoginPage onSignedIn={setUser} />;

  if (user.role === "responder") {
    const current = isResponderRoute(route) ? route : ({ page: "r-incidents" } as const);
    return (
      <div className="shell">
        <header className="topbar">
          <a className="brand" href={routeHref({ page: "r-incidents" })}>
            Warden <span>{user.organisation?.name ?? "Responders"}</span>
          </a>
          <div className="topbar-right">
            <span className="who">{user.email}</span>
            <button type="button" className="link-button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        <nav className="tabs responder-nav" aria-label="Responder sections">
          {RESPONDER_NAV.map((item) => {
            const active =
              item.route.page === current.page ||
              (item.route.page === "r-incidents" && current.page === "r-incident");
            return (
              <a
                key={item.label}
                href={routeHref(item.route)}
                className={active ? "tab active" : "tab"}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <main className="content">
          <ResponderContent route={current} />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={routeHref({ page: "queue", state: "held" })}>
          Warden <span>Moderation</span>
        </a>
        <div className="topbar-right">
          <span className="who">{user.email}</span>
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        {route.page === "incident" ? (
          <IncidentPage id={route.id} />
        ) : (
          <QueuePage state={route.page === "queue" ? route.state : "held"} />
        )}
      </main>
    </div>
  );
}
