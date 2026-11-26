import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type DeviceSummary, type EventEnvelope, type LocationPayload } from "../api.ts";
import { LocationMap, type Point } from "../components/LocationMap.tsx";

export function DeviceDetail() {
  const { id = "" } = useParams();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [events, setEvents] = useState<EventEnvelope<LocationPayload>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([api.getDevice(id), api.getEvents(id, "location", 200)]);
      setDevice(d.device);
      setEvents(e.events as EventEnvelope<LocationPayload>[]);
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
        <h2>History</h2>
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
