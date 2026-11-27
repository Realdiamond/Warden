import { Fragment, useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
  RefreshCw,
  Trash2,
  Copy,
  Settings,
  Bell,
  Search,
  X,
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

const APP_NAMES: Record<string, string> = {
  "com.whatsapp": "WhatsApp",
  "com.whatsapp.w4b": "WhatsApp Business",
  "org.telegram.messenger": "Telegram",
  "com.facebook.orca": "Messenger",
  "com.instagram.android": "Instagram",
  "com.snapchat.android": "Snapchat",
  "com.zhiliaoapp.musically": "TikTok",
  "com.ss.android.ugc.trill": "TikTok",
  "org.thoughtcrime.securesms": "Signal",
};

function appName(pkg: string): string {
  if (APP_NAMES[pkg]) return APP_NAMES[pkg];
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

interface ChatMsg {
  id: string;
  text: string;
  direction: "in" | "out";
  conversation: string;
  app: string;
  at: string;
}

interface Conversation {
  key: string;
  name: string;
  app: string;
  messages: ChatMsg[]; // ascending by time
  last: ChatMsg;
}

/** Group on-screen ("chat") captures into conversation threads, most-recent thread first. */
function buildConversations(chat: EventEnvelope<MessagePayload>[]): Conversation[] {
  const byKey = new Map<string, ChatMsg[]>();
  for (const m of chat) {
    const name = m.payload.conversation ?? m.payload.sender ?? "Unknown";
    const key = `${m.payload.app}|${name}`;
    const cm: ChatMsg = {
      id: m.id,
      text: m.payload.text,
      direction: m.payload.direction === "out" ? "out" : "in",
      conversation: name,
      app: m.payload.app,
      at: m.capturedAt,
    };
    const arr = byKey.get(key);
    if (arr) arr.push(cm);
    else byKey.set(key, [cm]);
  }
  return [...byKey.entries()]
    .map(([key, msgs]) => {
      const asc = [...msgs].sort((a, b) => a.at.localeCompare(b.at));
      return { key, name: asc[0].conversation, app: asc[0].app, messages: asc, last: asc[asc.length - 1] };
    })
    .sort((a, b) => b.last.at.localeCompare(a.last.at));
}

function initial(name: string): string {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : "?";
}

function shortTime(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(at: string): string {
  const d = new Date(at);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** A stable hue per conversation name, for the avatar chip. */
function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function callIcon(direction: string) {
  if (direction === "incoming") return <PhoneIncoming size={15} />;
  if (direction === "outgoing") return <PhoneOutgoing size={15} />;
  return <PhoneMissed size={15} />;
}

export function DeviceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [events, setEvents] = useState<EventEnvelope<LocationPayload>[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [messages, setMessages] = useState<EventEnvelope<MessagePayload>[]>([]);
  const [calls, setCalls] = useState<EventEnvelope<CallPayload>[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [cmdStatus, setCmdStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [notifSearch, setNotifSearch] = useState("");
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function relink() {
    setRelinkBusy(true);
    try {
      const r = await api.relinkDevice(id);
      setPairCode(r.pairCode);
      await load();
    } catch {
      setError("Could not generate a pairing code.");
    } finally {
      setRelinkBusy(false);
    }
  }

  async function removeDevice() {
    const name = device?.name ?? "this device";
    if (!window.confirm(`Delete ${name}? This removes the device and all of its captured data. This cannot be undone.`)) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.deleteDevice(id);
      navigate("/devices");
    } catch {
      setError("Could not delete the device.");
      setDeleteBusy(false);
    }
  }

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

  // Chat-bubble transcript comes ONLY from the on-screen (accessibility) reader — those are the
  // real two-sided chats captured when WhatsApp/Snapchat/TikTok etc. are opened on the phone.
  const chatMsgs = messages.filter((m) => m.payload.source === "chat");
  const notifMsgs = messages.filter((m) => m.payload.source !== "chat");
  const conversations = buildConversations(chatMsgs);
  const activeKey =
    selectedConv && conversations.some((c) => c.key === selectedConv)
      ? selectedConv
      : conversations[0]?.key ?? null;
  const active = conversations.find((c) => c.key === activeKey) ?? null;

  // Notification messages are a separate searchable list (filter by sender name, app or text).
  const notifQuery = notifSearch.trim().toLowerCase();
  const notifFiltered = notifQuery
    ? notifMsgs.filter((m) => {
        const sender = (m.payload.sender ?? "").toLowerCase();
        const text = (m.payload.text ?? "").toLowerCase();
        const app = appName(m.payload.app).toLowerCase();
        return sender.includes(notifQuery) || text.includes(notifQuery) || app.includes(notifQuery);
      })
    : notifMsgs;

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

      <section className="panel" data-testid="messages">
        <div className="panel-head">
          <MessageSquare size={16} />
          <h2>Chats</h2>
          {conversations.length > 0 && (
            <span className="panel-head-meta">
              from screen reader · {conversations.length} {conversations.length === 1 ? "chat" : "chats"}
            </span>
          )}
        </div>

        {conversations.length === 0 && (
          <p className="panel-empty">
            No on-screen chats yet. These are read when WhatsApp, Snapchat, TikTok, Telegram, etc. are
            opened on the phone — turn on <strong>Accessibility</strong> for Monitor on the phone to capture them.
          </p>
        )}

        {conversations.length > 0 && (
          <div className="chat" data-testid="chat">
            <aside className="chat-list">
              {conversations.map((c) => (
                <button
                  key={c.key}
                  className={`conv ${c.key === activeKey ? "active" : ""}`}
                  onClick={() => setSelectedConv(c.key)}
                >
                  <span className="conv-avatar" style={{ background: `hsl(${avatarHue(c.name)} 55% 42%)` }}>
                    {initial(c.name)}
                  </span>
                  <span className="conv-main">
                    <span className="conv-top">
                      <span className="conv-name">{c.name}</span>
                      <span className="conv-time">{shortTime(c.last.at)}</span>
                    </span>
                    <span className="conv-preview">
                      {c.last.direction === "out" && <span className="conv-you">You: </span>}
                      {c.last.text}
                    </span>
                  </span>
                </button>
              ))}
            </aside>

            <div className="chat-thread" data-testid="chat-thread">
              {active && (
                <>
                  <div className="thread-head">
                    <span
                      className="conv-avatar sm"
                      style={{ background: `hsl(${avatarHue(active.name)} 55% 42%)` }}
                    >
                      {initial(active.name)}
                    </span>
                    <div className="thread-id">
                      <div className="thread-name">{active.name}</div>
                      <div className="thread-app">{appName(active.app)}</div>
                    </div>
                  </div>
                  <div className="thread-body">
                    {active.messages.map((m, i) => {
                      const prev = active.messages[i - 1];
                      const showDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
                      return (
                        <Fragment key={m.id}>
                          {showDay && <div className="day-chip">{dayLabel(m.at)}</div>}
                          <div className={`bubble-row ${m.direction}`}>
                            <div className={`bubble ${m.direction}`}>
                              <span className="bubble-text">{m.text}</span>
                              <span className="bubble-time">{shortTime(m.at)}</span>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel" data-testid="notifications">
        <div className="panel-head">
          <Bell size={16} />
          <h2>Message notifications</h2>
          {notifMsgs.length > 0 && (
            <span className="panel-head-meta">
              {notifMsgs.length} {notifMsgs.length === 1 ? "notification" : "notifications"}
            </span>
          )}
        </div>
        {notifMsgs.length === 0 ? (
          <p className="panel-empty">No message notifications captured yet.</p>
        ) : (
          <>
            <div className="search-box">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search by name, app or text…"
                value={notifSearch}
                onChange={(e) => setNotifSearch(e.target.value)}
              />
              {notifSearch && (
                <button className="search-clear" onClick={() => setNotifSearch("")} aria-label="Clear">
                  <X size={14} />
                </button>
              )}
            </div>
            {notifFiltered.length === 0 ? (
              <p className="panel-empty">No notifications match "{notifSearch}".</p>
            ) : (
              <ul className="messages-list" data-testid="notif-list">
                {notifFiltered.map((m) => (
                  <li key={m.id} className="message-item">
                    <div className="msg-head">
                      <span className="msg-sender">{m.payload.sender ?? "Unknown"}</span>
                      <span className="msg-app">{appName(m.payload.app)}</span>
                      <span className="msg-time">{new Date(m.capturedAt).toLocaleString()}</span>
                    </div>
                    <div className="msg-text">{m.payload.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </>
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

      <section className="panel" data-testid="device-manage">
        <div className="panel-head">
          <Settings size={16} />
          <h2>Device</h2>
        </div>
        <p className="muted">
          Re-link this device to pair the app again (for example after reinstalling it on the phone),
          or remove the device and all of its data.
        </p>
        <div className="live-controls">
          <button className="secondary" onClick={relink} disabled={relinkBusy}>
            <RefreshCw size={15} />
            {relinkBusy ? "Generating…" : "Re-link (new pairing code)"}
          </button>
          <button className="danger-btn" onClick={removeDevice} disabled={deleteBusy}>
            <Trash2 size={15} />
            {deleteBusy ? "Deleting…" : "Delete device"}
          </button>
        </div>
        {pairCode && (
          <div className="card paircode" data-testid="relink-code" style={{ marginTop: "0.9rem" }}>
            <p>
              On the monitored phone, open the Monitor app and enter this pairing code. The person
              using that phone confirms consent. The code expires in 15 minutes.
            </p>
            <div className="code-row">
              <span className="code">{pairCode}</span>
              <button
                className="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(pairCode);
                }}
              >
                <Copy size={14} />
                Copy
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
