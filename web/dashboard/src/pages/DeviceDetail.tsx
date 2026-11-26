import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  api,
  type DeviceSummary,
  type EventEnvelope,
  type LocationPayload,
  type AppUsagePayload,
  type MessagePayload,
} from "../api.ts";
import { LocationMap, type Point } from "../components/LocationMap.tsx";

interface UsageRow {
  packageName: string;
  foregroundMs: number;
}

function aggregateUsage(events: EventEnvelope<AppUsagePayload>[]): UsageRow[] {
  // Events arrive newest-first; keep the latest reported total per package.
  const latest = new Map<string, number>();
  for (const e of events) {
    if (!latest.has(e.payload.packageName)) latest.set(e.payload.packageName, e.payload.foregroundMs);
  }
  return [...latest.entries()]
    .map(([packageName, foregroundMs]) => ({ packageName, foregroundMs }))
    .sort((a, b) => b.foregroundMs - a.foregroundMs);
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function appName(pkg: string): string {
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

export function DeviceDetail() {
  const { id = "" } = useParams();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [events, setEvents] = useState<EventEnvelope<LocationPayload>[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [messages, setMessages] = useState<EventEnvelope<MessagePayload>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, e, u, m] = await Promise.all([
        api.getDevice(id),
        api.getEvents(id, "location", 200),
        api.getEvents(id, "app_usage", 500),
        api.getEvents(id, "message", 100),
      ]);
      setDevice(d.device);
      setEvents(e.events as EventEnvelope<LocationPayload>[]);
      setUsage(aggregateUsage(u.events as EventEnvelope<AppUsagePayload>[]));
      setMessages(m.events as EventEnvelope<MessagePayload>[]);
    } catch {
      setError("Could not load this device.");
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const points: Point[] = events.map((e) => ({
    lat: e.payload.lat,
    lon: e.payload.lon,
    capturedAt: e.capturedAt,
  }));
  const latest = events[0];

  return (
    <div>
      <Link to="/devices" className="back">
        ← All devices
      </Link>
      <h1>{device?.name ?? "Device"}</h1>

      <div className="status-row">
        <span className={`badge ${device?.pairedAt ? "ok" : "pending"}`}>
          {device?.pairedAt ? "Paired" : "Awaiting pairing"}
        </span>
        <span className={`badge ${device?.consentAcceptedAt ? "ok" : "pending"}`}>
          {device?.consentAcceptedAt ? "Consent recorded" : "No consent"}
        </span>
        <span className="muted">
          {device?.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "Never seen"}
        </span>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Location</h2>
        {latest ? (
          <p className="muted" data-testid="latest-loc">
            Latest: {latest.payload.lat.toFixed(5)}, {latest.payload.lon.toFixed(5)}
            {latest.payload.accuracyM ? ` (±${Math.round(latest.payload.accuracyM)} m)` : ""} ·{" "}
            {new Date(latest.capturedAt).toLocaleString()}
          </p>
        ) : (
          <p className="muted">No location reported yet.</p>
        )}
        <LocationMap points={points} />
      </section>

      <section className="panel">
        <h2>App usage (today)</h2>
        {usage.length === 0 ? (
          <p className="muted">No app usage reported yet.</p>
        ) : (
          <ul className="usage" data-testid="usage">
            {usage.map((u) => (
              <li key={u.packageName}>
                <span className="usage-name">{appName(u.packageName)}</span>
                <span className="usage-pkg muted">{u.packageName}</span>
                <span className="usage-time">{formatDuration(u.foregroundMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Messages</h2>
        {messages.length === 0 ? (
          <p className="muted">No messages captured yet.</p>
        ) : (
          <ul className="messages" data-testid="messages">
            {messages.map((m) => (
              <li key={m.id}>
                <div className="msg-head">
                  <span className="msg-sender">{m.payload.sender ?? "Unknown"}</span>
                  <span className="msg-app muted">{appName(m.payload.app)}</span>
                  <span className="msg-time muted">{new Date(m.capturedAt).toLocaleString()}</span>
                </div>
                <div className="msg-text">{m.payload.text}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Location history</h2>
        {events.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="history">
            {events.map((e) => (
              <li key={e.id}>
                {new Date(e.capturedAt).toLocaleString()} — {e.payload.lat.toFixed(5)},{" "}
                {e.payload.lon.toFixed(5)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
