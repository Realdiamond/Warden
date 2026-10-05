import type { StaffUser } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, setUnauthorizedListener } from "./api.ts";
import { IncidentPage } from "./pages/IncidentPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { QueuePage } from "./pages/QueuePage.tsx";
import { parseRoute, type Route, routeHref } from "./router.ts";

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
        {route.page === "queue" ? (
          <QueuePage state={route.state} />
        ) : (
          <IncidentPage id={route.id} />
        )}
      </main>
    </div>
  );
}
