import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  MessageSquare,
  Phone,
  AppWindow,
  MapPin,
  Lock,
  Unlock,
  ScreenShare,
  ShieldBan,
  History as HistoryIcon,
  CheckCircle2,
  Clock,
  KeyRound,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
} from "lucide-react";
import {
  api,
  type DeviceSummary,
  type EventEnvelope,
  type LocationPayload,
  type AppUsagePayload,
  type MessagePayload,
  type CallPayload,
} from "../api.ts";
import { LocationMap, type Point } from "../components/LocationMap.tsx";
import { LiveScreen } from "../components/LiveScreen.tsx";

function formatCallDuration(sec: number): string {
  if (sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

interface UsageRow {
  packageName: string;
  foregroundMs: number;
}

function aggregateUsage(events: EventEnvelope<AppUsagePayload>[]): UsageRow[] {
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

function callIcon(direction: string) {
  if (direction === "incoming") return <PhoneIncoming size={15} />;
  if (direction === "outgoing") return <PhoneOutgoing size={15} />;
  return <PhoneMissed size={15} />;
}

export function DeviceDetail() {
  const { id = "" } = useParams();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [events, setEvents] = useState<EventEnvelope<LocationPayload>[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [messages, setMessages] = useState<EventEnvelope<MessagePayload>[]>([]);
  const [calls, setCalls] = useState<EventEnvelope<CallPayload>[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [cmdStatus, setCmdStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function sendCmd(type: "lock" | "unlock") {
    setCmdStatus("Sending…");
    try {
      await api.sendCommand(id, type);
      setCmdStatus(`"${type}" sent — the phone applies it within about a minute.`);
    } catch {
      setCmdStatus("Could not send the command.");
    }
  }

  const load = useCallback(async () => {
    try {
      const [d, e, u, m, c] = await Promise.all([
        api.getDevice(id),
        api.getEvents(id, "location", 200),
        api.getEvents(id, "app_usage", 500),
        api.getEvents(id, "message", 100),
        api.getEvents(id, "call", 100),
      ]);
      setDevice(d.device);
      setBlocked(d.device.blockedApps ?? []);
      setEvents(e.events as EventEnvelope<LocationPayload>[]);
      setUsage(aggregateUsage(u.events as EventEnvelope<AppUsagePayload>[]));
      setMessages(m.events as EventEnvelope<MessagePayload>[]);
      setCalls(c.events as EventEnvelope<CallPayload>[]);
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
  const totalUsageMs = usage.reduce((sum, u) => sum + u.foregroundMs, 0);

  const knownApps = Array.from(new Set([...usage.map((u) => u.packageName), ...blocked])).sort();
  async function toggleBlock(pkg: string) {
    const prev = blocked;
    const next = blocked.includes(pkg) ? blocked.filter((p) => p !== pkg) : [...blocked, pkg];
    setBlocked(next);
    try {
      await api.setRules(id, next);
    } catch {
      setBlocked(prev);
    }
  }

  return (
    <div>
      <Link to="/devices" className="back-link">
        <ArrowLeft size={14} />
        All devices
      </Link>

      <div className="page-header">
        <div className="page-header-text">
          <h1>{device?.name ?? "Device"}</h1>
          <div className="status-row">
            <span className={`badge ${device?.pairedAt ? "ok" : "pending"}`}>
              {device?.pairedAt ? <CheckCircle2 /> : <Clock />}
              {device?.pairedAt ? "Paired" : "Awaiting pairing"}
            </span>
            <span className={`badge ${device?.consentAcceptedAt ? "ok" : "pending"}`}>
              <KeyRound />
              {device?.consentAcceptedAt ? "Consent recorded" : "No consent"}
            </span>
            <span className="muted mono" style={{ fontSize: "0.82rem" }}>
              {device?.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "Never seen"}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-icon violet">
            <MessageSquare size={15} />
          </span>
          <span className="stat-value">{messages.length}</span>
          <span className="stat-label">Messages captured</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon blue">
            <Phone size={15} />
          </span>
          <span className="stat-value">{calls.length}</span>
          <span className="stat-label">Calls logged</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <AppWindow size={15} />
          </span>
          <span className="stat-value">{formatDuration(totalUsageMs)}</span>
          <span className="stat-label">Screen time today</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon emerald">
            <MapPin size={15} />
          </span>
          <span className="stat-value">{points.length}</span>
          <span className="stat-label">Location fixes</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <MessageSquare size={16} />
          <h2>Messages</h2>
        </div>
        {messages.length === 0 ? (
          <p className="panel-empty">No messages captured yet.</p>
        ) : (
          <ul className="messages-list" data-testid="messages">
            {messages.map((m) => (
              <li key={m.id} className={`message-item ${m.payload.source === "chat" ? "on-screen" : ""}`}>
                <div className="msg-head">
                  <span className="msg-sender">{m.payload.sender ?? "Unknown"}</span>
                  <span className="msg-app">{appName(m.payload.app)}</span>
                  {m.payload.source === "chat" && <span className="msg-src">on-screen</span>}
                  <span className="msg-time">{new Date(m.capturedAt).toLocaleString()}</span>
                </div>
                <div className="msg-text">{m.payload.text}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <Lock size={16} />
          <h2>Remote lock</h2>
        </div>
        <p className="muted">
          Lock works on a normal phone (needs device-admin enabled on it). Unlocking the PIN needs
          the phone set up as a managed device.
        </p>
        <div className="live-controls">
          <button className="secondary" onClick={() => sendCmd("lock")}>
            <Lock size={15} />
            Lock phone
          </button>
          <button className="secondary" onClick={() => sendCmd("unlock")}>
            <Unlock size={15} />
            Unlock phone
          </button>
          {cmdStatus && <span className="muted">{cmdStatus}</span>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <ScreenShare size={16} />
          <h2>Live screen</h2>
        </div>
        <p className="muted">
          The phone shows an indicator while you watch. The person approves screen sharing once on
          the phone. Tick "Control" to tap on the phone by clicking the image.
        </p>
        <LiveScreen deviceId={id} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <MapPin size={16} />
          <h2>Location</h2>
        </div>
        {latest ? (
          <p className="muted mono" data-testid="latest-loc" style={{ fontSize: "0.85rem" }}>
            Latest: {latest.payload.lat.toFixed(5)}, {latest.payload.lon.toFixed(5)}
            {latest.payload.accuracyM ? ` (±${Math.round(latest.payload.accuracyM)} m)` : ""} ·{" "}
            {new Date(latest.capturedAt).toLocaleString()}
          </p>
        ) : (
          <p className="panel-empty">No location reported yet.</p>
        )}
        <LocationMap points={points} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <AppWindow size={16} />
          <h2>App usage (today)</h2>
        </div>
        {usage.length === 0 ? (
          <p className="panel-empty">No app usage reported yet.</p>
        ) : (
          <ul className="row-list" data-testid="usage">
            {usage.map((u) => (
              <li key={u.packageName} className="row-item">
                <span className="row-icon">
                  <AppWindow size={14} />
                </span>
                <div className="row-main">
                  <span className="row-title">{appName(u.packageName)}</span>
                  <span className="row-sub">{u.packageName}</span>
                </div>
                <span className="row-value">{formatDuration(u.foregroundMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <ShieldBan size={16} />
          <h2>App limits</h2>
        </div>
        <p className="muted">A blocked app is sent back to the home screen when it's opened.</p>
        {knownApps.length === 0 ? (
          <p className="panel-empty">No apps seen yet — they appear here once the phone reports usage.</p>
        ) : (
          <ul className="row-list" data-testid="limits">
            {knownApps.map((pkg) => {
              const isBlocked = blocked.includes(pkg);
              return (
                <li key={pkg} className="limit-row">
                  <span className="row-icon">
                    <AppWindow size={14} />
                  </span>
                  <div className="row-main">
                    <span className="row-title">{appName(pkg)}</span>
                    <span className="row-sub">{pkg}</span>
                  </div>
                  <label className={`switch danger ${isBlocked ? "active" : ""}`}>
                    {isBlocked ? "Blocked" : "Allowed"}
                    <input type="checkbox" checked={isBlocked} onChange={() => toggleBlock(pkg)} />
                    <span className="switch-track" />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <Phone size={16} />
          <h2>Calls</h2>
        </div>
        {calls.length === 0 ? (
          <p className="panel-empty">No calls captured yet.</p>
        ) : (
          <ul className="row-list" data-testid="calls">
            {calls.map((c) => (
              <li key={c.id} className="row-item">
                <span className="row-icon">{callIcon(c.payload.direction)}</span>
                <div className="row-main">
                  <span className="row-title mono">{c.payload.number ?? "Unknown"}</span>
                  <span className="row-sub">{formatCallDuration(c.payload.durationSec)}</span>
                </div>
                <span className={`call-dir call-${c.payload.direction}`}>{c.payload.direction}</span>
                <span className="row-time">{new Date(c.capturedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <HistoryIcon size={16} />
          <h2>Location history</h2>
        </div>
        {events.length === 0 ? (
          <p className="panel-empty">Nothing yet.</p>
        ) : (
          <ul className="history-list">
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
