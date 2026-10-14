import { parseViewFragment, type SessionView } from "@warden/shared";
import { lazy, Suspense, useEffect, useState } from "react";
import { fetchSession } from "./liveApi.ts";

const LiveMap = lazy(() => import("./LiveMap.tsx"));

const POLL_MS = 15_000;
const ALARM_POLL_MS = 8_000;

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

export function headline(view: SessionView): { tone: "alarm" | "calm" | "done"; text: string } {
  const name = view.personName;
  if (view.state === "ended") {
    const how =
      view.outcome === "arrived"
        ? "arrived safely"
        : view.outcome === "safe"
          ? "said they are safe"
          : view.outcome === "expired"
            ? "stopped sharing (time limit)"
            : "stopped sharing";
    return {
      tone: "done",
      text: `${name} ${how}${view.endedAt ? ` at ${clock(view.endedAt)}` : ""}.`,
    };
  }
  if (view.duress) return { tone: "alarm", text: `${name} may be in danger and unable to say so.` };
  if (view.kind === "sos") return { tone: "alarm", text: `${name} has asked for help (SOS).` };
  if (view.state === "overdue")
    return { tone: "alarm", text: `${name} has not arrived as planned.` };
  return { tone: "calm", text: `${name} is sharing their trip with you.` };
}

export function LivePage() {
  const [link] = useState(() => parseViewFragment(window.location.hash));
  const [view, setView] = useState<SessionView | null>(null);
  const [gone, setGone] = useState(false);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!link) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const result = await fetchSession(link.sessionId, link.viewToken);
      if (stopped) return;
      setNow(Date.now());
      if (result.kind === "gone") {
        setGone(true);
        return;
      }
      setOffline(result.kind === "error");
      if (result.kind === "ok") setView(result.view);
      const alarm = result.kind === "ok" && result.view.alarm;
      const ended = result.kind === "ok" && result.view.state === "ended";
      if (!ended) timer = setTimeout(() => void load(), alarm ? ALARM_POLL_MS : POLL_MS);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [link]);

  if (!link) {
    return (
      <main className="live">
        <h1>Warden</h1>
        <p>This link is incomplete. Ask the person who sent it to share it again.</p>
      </main>
    );
  }
  if (gone) {
    return (
      <main className="live">
        <h1>Warden</h1>
        <p>This link has expired or is not valid. Shared locations are deleted after two days.</p>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="live">
        <p aria-live="polite">{offline ? "Cannot reach Warden. Retrying..." : "Loading..."}</p>
      </main>
    );
  }

  const head = headline(view);
  const last = view.lastPoint;
  const mapsLink = last
    ? `https://www.google.com/maps/search/?api=1&query=${last.lat.toFixed(6)},${last.lng.toFixed(6)}`
    : null;

  return (
    <main className="live">
      <header
        className={`live-head live-${head.tone}`}
        role={head.tone === "alarm" ? "alert" : undefined}
      >
        <p className="live-brand">Warden</p>
        <h1>{head.text}</h1>
        {head.tone === "alarm" && (
          <p>Try to call them. If you cannot reach them or think they are in danger, call 112.</p>
        )}
      </header>

      {head.tone === "alarm" && (
        <a className="live-call" href="tel:112">
          Call 112
        </a>
      )}

      <Suspense fallback={<div className="live-map live-map-empty">Loading map...</div>}>
        <LiveMap view={view} />
      </Suspense>

      <dl className="live-facts">
        <dt>Last location</dt>
        <dd>
          {last ? (
            <>
              {ago(last.at, now)}
              {last.accuracyM !== null && ` · within about ${Math.round(last.accuracyM)} m`}
              {mapsLink && (
                <>
                  {" · "}
                  <a href={mapsLink} target="_blank" rel="noreferrer noopener">
                    Open in maps
                  </a>
                </>
              )}
            </>
          ) : (
            "Not received yet"
          )}
        </dd>
        {last?.battery !== null && last?.battery !== undefined && (
          <>
            <dt>Phone battery</dt>
            <dd>{last.battery}%</dd>
          </>
        )}
        {view.destination && (
          <>
            <dt>Going to</dt>
            <dd>{view.destination.label ?? "A place on the map"}</dd>
          </>
        )}
        {view.expectedArrivalAt && (
          <>
            <dt>Expected by</dt>
            <dd>{clock(view.expectedArrivalAt)}</dd>
          </>
        )}
        {view.note && (
          <>
            <dt>Note from {view.personName}</dt>
            <dd>{view.note}</dd>
          </>
        )}
        <dt>Started</dt>
        <dd>{clock(view.startedAt)}</dd>
      </dl>

      {offline && <p className="live-note">Cannot reach Warden right now. Retrying...</p>}
      <p className="live-note">
        Only people with this link can see this page. Please do not share it. Warden does not
        replace 112.
      </p>
    </main>
  );
}
