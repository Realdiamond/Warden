import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
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
  Sun,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Check,
  type LucideIcon,
} from "lucide-react";
import {
  api,
  type DeviceSummary,
  type EventEnvelope,
  type LocationPayload,
  type AppUsagePayload,
  type MessagePayload,
  type CallPayload,
  type StatusPayload,
} from "../api.ts";
import { LocationMap, type Point } from "../components/LocationMap.tsx";
import { LiveScreen } from "../components/LiveScreen.tsx";
import {
  appName,
  avatarHue,
  dayLabel,
  formatCallDuration,
  formatDuration,
  formatPairCode,
  initial,
  metersBetween,
  pluralize,
  presence,
  shortTime,
} from "../lib/format.ts";

/* ---------------------------------------------------------------- data shaping */

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

function callIcon(direction: string) {
  if (direction === "incoming") return <PhoneIncoming size={16} />;
  if (direction === "outgoing") return <PhoneOutgoing size={16} />;
  return <PhoneMissed size={16} />;
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
  messages: ChatMsg[];
  last: ChatMsg;
}

function convKeyOf(app: string, name: string): string {
  return `${app}|${name}`;
}

/** Group on-screen captures into conversation threads, most recent thread first. */
function buildConversations(chat: EventEnvelope<MessagePayload>[]): Conversation[] {
  const byKey = new Map<string, ChatMsg[]>();
  for (const m of chat) {
    const name = m.payload.conversation ?? m.payload.sender ?? "Unknown";
    const key = convKeyOf(m.payload.app, name);
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

/* ---------------------------------------------------------------- today timeline */

type Kind = "chat" | "call" | "place" | "alert";

interface TlItem {
  id: string;
  at: string;
  hour: number;
  kind: Kind;
  title: string;
  tag?: string;
  sub?: string;
  count?: number;
  convKey?: string;
}

const KIND_META: Record<Kind, { label: string; icon: LucideIcon; color: string }> = {
  chat: { label: "Chats", icon: MessageSquare, color: "var(--t-chat)" },
  call: { label: "Calls", icon: Phone, color: "var(--t-call)" },
  place: { label: "Places", icon: MapPin, color: "var(--t-place)" },
  alert: { label: "Alerts", icon: Bell, color: "var(--t-alert)" },
};

const KINDS: Kind[] = ["chat", "call", "place", "alert"];

function dayBounds(offset: number): [number, number, Date] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime(), start];
}

const CALL_WORDS: Record<string, string> = {
  incoming: "Incoming call",
  outgoing: "Outgoing call",
  missed: "Missed call",
  rejected: "Declined call",
};

/** Every captured event inside the chosen day as a flat list (not yet grouped or filtered). */
function buildRaw(
  [from, to]: [number, number, Date],
  messages: EventEnvelope<MessagePayload>[],
  calls: EventEnvelope<CallPayload>[],
  locations: EventEnvelope<LocationPayload>[],
): TlItem[] {
  const inDay = (at: string) => {
    const t = new Date(at).getTime();
    return t >= from && t < to;
  };
  const items: TlItem[] = [];

  for (const m of messages) {
    if (!inDay(m.capturedAt)) continue;
    const p = m.payload;
    const hour = new Date(m.capturedAt).getHours();
    if (p.source === "chat") {
      const name = p.conversation ?? p.sender ?? "Unknown";
      items.push({
        id: m.id,
        at: m.capturedAt,
        hour,
        kind: "chat",
        title: name,
        tag: appName(p.app),
        sub: `${p.direction === "out" ? "You: " : ""}${p.text}`,
        convKey: convKeyOf(p.app, name),
      });
    } else {
      items.push({
        id: m.id,
        at: m.capturedAt,
        hour,
        kind: "alert",
        title: p.sender ?? "Unknown",
        tag: `${appName(p.app)} alert`,
        sub: p.text,
      });
    }
  }

  for (const c of calls) {
    if (!inDay(c.capturedAt)) continue;
    const p = c.payload;
    const word = CALL_WORDS[p.direction] ?? "Call";
    const answered = p.durationSec > 0;
    items.push({
      id: c.id,
      at: c.capturedAt,
      hour: new Date(c.capturedAt).getHours(),
      kind: "call",
      title: p.name ?? p.number ?? "Unknown number",
      tag: answered ? `${word}, ${formatCallDuration(p.durationSec)}` : word,
      sub: p.name && p.number ? p.number : undefined,
    });
  }

  // Locations: keep a point only when the phone has moved a meaningful distance, so the timeline
  // shows "went somewhere", not a fix every minute.
  const asc = locations.filter((l) => inDay(l.capturedAt)).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  let last: { lat: number; lon: number } | null = null;
  for (const l of asc) {
    const here = { lat: l.payload.lat, lon: l.payload.lon };
    if (last && metersBetween(last, here) < 75) continue;
    items.push({
      id: l.id,
      at: l.capturedAt,
      hour: new Date(l.capturedAt).getHours(),
      kind: "place",
      title: last ? "Moved to a new spot" : "First location of the day",
      sub: `${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}`,
    });
    last = here;
  }
  return items;
}

/** Newest first; runs of messages in the same chat (within 30 minutes) fold into one row. */
function groupForDisplay(items: TlItem[]): TlItem[] {
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
  const out: TlItem[] = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    if (
      it.kind === "chat" &&
      prev &&
      prev.kind === "chat" &&
      prev.convKey === it.convKey &&
      new Date(prev.at).getTime() - new Date(it.at).getTime() < 30 * 60_000
    ) {
      prev.count = (prev.count ?? 1) + 1;
      continue;
    }
    out.push({ ...it, count: it.kind === "chat" ? 1 : undefined });
  }
  return out;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function summarize(counts: Record<Kind, number>): string {
  const parts: string[] = [];
  if (counts.chat) parts.push(pluralize(counts.chat, "chat message"));
  if (counts.alert) parts.push(pluralize(counts.alert, "alert"));
  if (counts.call) parts.push(pluralize(counts.call, "call"));
  if (counts.place) parts.push(pluralize(counts.place, "location update"));
  return parts.length ? `${joinList(parts)}.` : "Nothing captured for this day.";
}

function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

/* ---------------------------------------------------------------- navigation */

type TabId =
  | "today"
  | "chats"
  | "notifications"
  | "calls"
  | "location"
  | "apps"
  | "live"
  | "setup"
  | "device";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "today", label: "Today", icon: Sun },
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "notifications", label: "Alerts", icon: Bell },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "location", label: "Location", icon: MapPin },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "live", label: "Live", icon: ScreenShare },
  { id: "setup", label: "Setup", icon: ListChecks },
  { id: "device", label: "Device", icon: Settings },
];

type PermKey = "location" | "usage" | "deviceAdmin" | "notifications" | "accessibility";

const CAPABILITIES: { key: PermKey; name: string; desc: string; steps?: string }[] = [
  { key: "location", name: "Location", desc: "Where the phone is, on the map" },
  { key: "usage", name: "App usage", desc: "Screen time and app limits" },
  {
    key: "deviceAdmin",
    name: "Remote lock",
    desc: "Lock the phone from here",
    steps: "On the phone, open Monitor and tap “Enable remote lock”, then confirm.",
  },
  {
    key: "notifications",
    name: "Notifications",
    desc: "See message alerts as they arrive",
    steps: "On the phone, open Monitor and tap “Grant notification access”, then switch Monitor on.",
  },
  {
    key: "accessibility",
    name: "Accessibility",
    desc: "Read chats in WhatsApp, Snapchat, TikTok and similar apps",
    steps:
      "On the phone: Settings → Accessibility → Monitor → turn On. If it’s greyed out: Settings → Apps → Monitor → ⋮ → Allow restricted settings, then try again.",
  },
];

const PAGE = 40;

/* ---------------------------------------------------------------- page */

export function DeviceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [events, setEvents] = useState<EventEnvelope<LocationPayload>[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [messages, setMessages] = useState<EventEnvelope<MessagePayload>[]>([]);
  const [calls, setCalls] = useState<EventEnvelope<CallPayload>[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [statusEvt, setStatusEvt] = useState<EventEnvelope<StatusPayload> | null>(null);
  const [cmdStatus, setCmdStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [notifSearch, setNotifSearch] = useState("");
  const [callSearch, setCallSearch] = useState("");
  const [tab, setTab] = useState<TabId>("today");
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Today tab state
  const [dayOffset, setDayOffset] = useState(0);
  const [hour, setHour] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<Kind | "all">("all");
  const [visible, setVisible] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      const [d, e, u, m, c, s] = await Promise.all([
        api.getDevice(id),
        api.getEvents(id, "location", 200),
        api.getEvents(id, "app_usage", 500),
        api.getEvents(id, "message", 200),
        api.getEvents(id, "call", 100),
        api.getEvents(id, "status", 1),
      ]);
      setDevice(d.device);
      setBlocked(d.device.blockedApps ?? []);
      setEvents(e.events as EventEnvelope<LocationPayload>[]);
      setUsage(aggregateUsage(u.events as EventEnvelope<AppUsagePayload>[]));
      setMessages(m.events as EventEnvelope<MessagePayload>[]);
      setCalls(c.events as EventEnvelope<CallPayload>[]);
      setStatusEvt((s.events[0] as EventEnvelope<StatusPayload>) ?? null);
      setError(null);
    } catch {
      setError("Could not load this device. Check your connection and refresh.");
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function sendCmd(type: "lock" | "unlock") {
    setCmdStatus("Sending…");
    try {
      await api.sendCommand(id, type);
      setCmdStatus(`"${type}" sent. The phone applies it within about a minute.`);
    } catch {
      setCmdStatus("Could not send the command. Try again.");
    }
  }

  async function relink() {
    setRelinkBusy(true);
    try {
      const r = await api.relinkDevice(id);
      setPairCode(r.pairCode);
      await load();
    } catch {
      setError("Could not generate a pairing code. Try again.");
    } finally {
      setRelinkBusy(false);
    }
  }

  async function removeDevice() {
    const name = device?.name ?? "this device";
    if (!window.confirm(`Delete ${name}? This removes the device and everything it reported. This can't be undone.`)) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.deleteDevice(id);
      navigate("/devices");
    } catch {
      setError("Could not delete the device. Try again.");
      setDeleteBusy(false);
    }
  }

  const points: Point[] = useMemo(
    () => events.map((e) => ({ lat: e.payload.lat, lon: e.payload.lon, capturedAt: e.capturedAt })),
    [events],
  );
  const latest = events[0];

  const chatMsgs = useMemo(() => messages.filter((m) => m.payload.source === "chat"), [messages]);
  const notifMsgs = useMemo(() => messages.filter((m) => m.payload.source !== "chat"), [messages]);
  const conversations = useMemo(() => buildConversations(chatMsgs), [chatMsgs]);
  const activeKey =
    selectedConv && conversations.some((c) => c.key === selectedConv)
      ? selectedConv
      : conversations[0]?.key ?? null;
  const active = conversations.find((c) => c.key === activeKey) ?? null;

  const notifQuery = notifSearch.trim().toLowerCase();
  const notifFiltered = notifQuery
    ? notifMsgs.filter((m) => {
        const sender = (m.payload.sender ?? "").toLowerCase();
        const text = (m.payload.text ?? "").toLowerCase();
        return sender.includes(notifQuery) || text.includes(notifQuery) || appName(m.payload.app).toLowerCase().includes(notifQuery);
      })
    : notifMsgs;

  const callQuery = callSearch.trim().toLowerCase();
  const callsFiltered = callQuery
    ? calls.filter((c) => {
        const name = (c.payload.name ?? "").toLowerCase();
        const number = (c.payload.number ?? "").toLowerCase();
        return name.includes(callQuery) || number.includes(callQuery);
      })
    : calls;

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

  /* Today: raw events for the chosen day, the per-hour ribbon, then filtered + grouped rows. */
  const bounds = useMemo(() => dayBounds(dayOffset), [dayOffset]);
  const raw = useMemo(() => buildRaw(bounds, messages, calls, events), [bounds, messages, calls, events]);
  const perHour = useMemo(() => {
    const a = new Array<number>(24).fill(0);
    for (const it of raw) a[it.hour]++;
    return a;
  }, [raw]);
  const maxHour = Math.max(1, ...perHour);
  const kindCounts = useMemo(() => {
    const c: Record<Kind, number> = { chat: 0, call: 0, place: 0, alert: 0 };
    for (const it of raw) c[it.kind]++;
    return c;
  }, [raw]);
  const rows = useMemo(
    () =>
      groupForDisplay(
        raw.filter((it) => (hour === null || it.hour === hour) && (kindFilter === "all" || it.kind === kindFilter)),
      ),
    [raw, hour, kindFilter],
  );
  const nowHour = dayOffset === 0 ? new Date().getHours() : -1;

  function stepDay(delta: number) {
    setDayOffset((o) => Math.min(0, o + delta));
    setHour(null);
    setVisible(PAGE);
  }

  const pres = presence(device?.lastSeenAt);

  // Setup checklist: which phone permissions the device last reported.
  const perms = statusEvt?.payload.permissions;
  const setupCaps = perms
    ? [...CAPABILITIES].sort((a, b) => Number(!!perms[b.key]) - Number(!!perms[a.key]))
    : CAPABILITIES;
  const setupOn = perms ? CAPABILITIES.filter((c) => perms[c.key]).length : 0;
  const setupOff = perms ? CAPABILITIES.length - setupOn : 0;
  const setupComplete = !!perms && setupOff === 0;

  const tabCount: Partial<Record<TabId, number>> = {
    chats: conversations.length,
    notifications: notifMsgs.length,
    calls: calls.length,
    setup: perms && setupOff > 0 ? setupOff : undefined,
  };

  // First paint before the device has loaded: show a skeleton so the header and panel don't flash
  // empty and then jump as data arrives.
  if (!device && !error) {
    return (
      <div>
        <Link to="/devices" className="back-link">
          <ArrowLeft size={15} />
          All devices
        </Link>
        <header className="masthead">
          <div className="skel skel-title" />
          <div className="skel skel-line" style={{ width: 150, marginTop: "0.9rem" }} />
        </header>
        <div className="device-layout">
          <nav className="device-nav" aria-hidden="true">
            {TABS.map((t) => (
              <div key={t.id} className="skel skel-nav" />
            ))}
          </nav>
          <div className="device-body">
            <section className="panel">
              <div className="skel skel-line" style={{ width: "35%" }} />
              <div className="skel skel-block" />
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/devices" className="back-link">
        <ArrowLeft size={15} />
        All devices
      </Link>

      <header className="masthead">
        <h1>{device?.name ?? "Device"}</h1>
        <div className={`presence ${pres.live ? "live" : ""}`}>
          <span className="presence-dot" />
          {pres.label}
        </div>
        <div className="status-row">
          <span className={`badge ${device?.pairedAt ? "ok" : "pending"}`}>
            {device?.pairedAt ? <CheckCircle2 /> : <Clock />}
            {device?.pairedAt ? "Paired" : "Waiting for the phone"}
          </span>
          <span className={`badge ${device?.consentAcceptedAt ? "ok" : "pending"}`}>
            <KeyRound />
            {device?.consentAcceptedAt ? "Consent recorded" : "No consent yet"}
          </span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="device-layout">
        <nav className="device-nav" data-testid="device-nav" aria-label="Device sections">
          {TABS.map((t) => {
            const Icon = t.icon;
            const count = tabCount[t.id];
            return (
              <button
                key={t.id}
                className={`device-nav-item ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{t.label}</span>
                {count ? <span className={`nav-count ${t.id === "setup" ? "warn" : ""}`}>{count}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="device-body">
          {/* ------------------------------------------------------------- Today */}
          {tab === "today" && (
            <section className="panel" data-testid="today">
              <div className="today-head">
                <div>
                  <h2>{dayLabel(bounds[2])}</h2>
                  <p className="today-summary">{summarize(kindCounts)}</p>
                </div>
                <div className="day-step">
                  <button className="secondary" aria-label="Previous day" onClick={() => stepDay(-1)}>
                    <ChevronLeft size={17} />
                  </button>
                  <button className="secondary" aria-label="Next day" onClick={() => stepDay(1)} disabled={dayOffset === 0}>
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>

              <div className="ribbon" data-testid="ribbon">
                <div className="ribbon-bars" role="group" aria-label="Activity by hour. Choose an hour to filter the timeline.">
                  {perHour.map((count, h) => {
                    const pct = count === 0 ? 0 : Math.max(14, Math.round((count / maxHour) * 100));
                    const text = `${hourLabel(h)}: ${pluralize(count, "event")}`;
                    return (
                      <button
                        key={h}
                        className={`ribbon-col ${count ? "busy" : ""} ${hour === h ? "selected" : ""} ${h === nowHour ? "now" : ""}`}
                        disabled={count === 0}
                        aria-pressed={hour === h}
                        aria-label={text}
                        title={text}
                        onClick={() => {
                          setHour(hour === h ? null : h);
                          setVisible(PAGE);
                        }}
                      >
                        <span className="ribbon-fill" style={{ height: `${pct}%` }} />
                      </button>
                    );
                  })}
                </div>
                <div className="ribbon-axis" aria-hidden="true">
                  <span>12 am</span>
                  <span>6 am</span>
                  <span>12 pm</span>
                  <span>6 pm</span>
                </div>
              </div>

              <div className="chips" role="group" aria-label="Filter by kind">
                <button className={`chip ${kindFilter === "all" ? "active" : ""}`} onClick={() => setKindFilter("all")}>
                  Everything
                </button>
                {KINDS.map((k) => (
                  <button
                    key={k}
                    className={`chip ${kindFilter === k ? "active" : ""}`}
                    onClick={() => setKindFilter(kindFilter === k ? "all" : k)}
                  >
                    {KIND_META[k].label} {kindCounts[k]}
                  </button>
                ))}
                {hour !== null && (
                  <button className="chip chip-clear" onClick={() => setHour(null)}>
                    Showing {hourLabel(hour)} only. Show the whole day
                  </button>
                )}
              </div>

              {rows.length === 0 ? (
                <p className="panel-empty">
                  {raw.length === 0
                    ? "Nothing was captured on this day."
                    : "Nothing matches these filters."}
                </p>
              ) : (
                <>
                  <ol className="timeline" data-testid="timeline">
                    {rows.slice(0, visible).map((it) => {
                      const meta = KIND_META[it.kind];
                      const Icon = meta.icon;
                      const open = it.kind === "chat" && it.convKey;
                      return (
                        <li
                          key={it.id}
                          className={`tl-row ${open ? "clickable" : ""}`}
                          onClick={
                            open
                              ? () => {
                                  setSelectedConv(it.convKey!);
                                  setTab("chats");
                                }
                              : undefined
                          }
                        >
                          <span className="tl-time">{shortTime(it.at)}</span>
                          <span className="tl-node">
                            <span className="tl-dot" style={{ ["--k" as string]: meta.color }}>
                              <Icon />
                            </span>
                          </span>
                          <div className="tl-main">
                            <div className="tl-head">
                              <span className="tl-title">{it.title}</span>
                              {it.tag && <span className="tl-tag">{it.tag}</span>}
                              {it.count && it.count > 1 ? <span className="tl-tag">{it.count} messages</span> : null}
                            </div>
                            {it.sub && <div className="tl-sub">{it.sub}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {rows.length > visible && (
                    <div className="tl-more">
                      <button className="secondary" onClick={() => setVisible((v) => v + PAGE)}>
                        Show {Math.min(PAGE, rows.length - visible)} more
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* ------------------------------------------------------------- Chats */}
          {tab === "chats" && (
            <section className="panel" data-testid="messages">
              <div className="panel-head">
                <MessageSquare size={18} />
                <h2>Chats</h2>
                {conversations.length > 0 && (
                  <span className="panel-head-meta">{pluralize(conversations.length, "conversation")}</span>
                )}
              </div>

              {conversations.length === 0 ? (
                <p className="panel-empty">
                  Chats appear here when the phone's screen reader sees a conversation open in WhatsApp,
                  Snapchat, TikTok, Telegram and similar apps. On the phone, turn on{" "}
                  <strong>Accessibility</strong> for Monitor.
                </p>
              ) : (
                <div className="chat" data-testid="chat">
                  <aside className="chat-list">
                    {conversations.map((c) => (
                      <button
                        key={c.key}
                        className={`conv ${c.key === activeKey ? "active" : ""}`}
                        onClick={() => setSelectedConv(c.key)}
                      >
                        <span className="conv-avatar" style={{ background: `hsl(${avatarHue(c.name)} 48% 40%)` }}>
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
                          <span className="conv-avatar sm" style={{ background: `hsl(${avatarHue(active.name)} 48% 40%)` }}>
                            {initial(active.name)}
                          </span>
                          <div>
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
          )}

          {/* ------------------------------------------------------------- Alerts */}
          {tab === "notifications" && (
            <section className="panel" data-testid="notifications">
              <div className="panel-head">
                <Bell size={18} />
                <h2>Alerts</h2>
                {notifMsgs.length > 0 && (
                  <span className="panel-head-meta">{pluralize(notifMsgs.length, "alert")}</span>
                )}
              </div>
              {notifMsgs.length === 0 ? (
                <p className="panel-empty">
                  Alerts are the message notifications the phone shows. None captured yet.
                </p>
              ) : (
                <>
                  <div className="search-box">
                    <Search size={16} />
                    <input
                      type="text"
                      aria-label="Search alerts"
                      placeholder="Search by name, app or text"
                      value={notifSearch}
                      onChange={(e) => setNotifSearch(e.target.value)}
                    />
                    {notifSearch && (
                      <button className="search-clear" onClick={() => setNotifSearch("")} aria-label="Clear search">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {notifFiltered.length === 0 ? (
                    <p className="panel-empty">No alerts match "{notifSearch}".</p>
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
          )}

          {/* ------------------------------------------------------------- Calls */}
          {tab === "calls" && (
            <section className="panel">
              <div className="panel-head">
                <Phone size={18} />
                <h2>Calls</h2>
                {calls.length > 0 && <span className="panel-head-meta">{pluralize(calls.length, "call")}</span>}
              </div>
              {calls.length === 0 ? (
                <p className="panel-empty">No calls captured yet.</p>
              ) : (
                <>
                  <div className="search-box">
                    <Search size={16} />
                    <input
                      type="text"
                      aria-label="Search calls"
                      placeholder="Search by name or number…"
                      value={callSearch}
                      onChange={(e) => setCallSearch(e.target.value)}
                    />
                    {callSearch && (
                      <button className="search-clear" onClick={() => setCallSearch("")} aria-label="Clear search">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {callsFiltered.length === 0 ? (
                    <p className="panel-empty">No calls match "{callSearch}".</p>
                  ) : (
                    <ul className="row-list" data-testid="calls">
                      {callsFiltered.map((c) => (
                        <li key={c.id} className="row-item">
                          <span className="row-icon">{callIcon(c.payload.direction)}</span>
                          <div className="row-main">
                            <span className="row-title">{c.payload.name ?? c.payload.number ?? "Unknown"}</span>
                            <span className="row-sub">
                              {c.payload.name && c.payload.number ? `${c.payload.number}, ` : ""}
                              {formatCallDuration(c.payload.durationSec)}
                            </span>
                          </div>
                          <span className={`call-dir call-${c.payload.direction}`}>{c.payload.direction}</span>
                          <span className="row-time">{new Date(c.capturedAt).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}

          {/* ------------------------------------------------------------- Location */}
          {tab === "location" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <MapPin size={18} />
                  <h2>Location</h2>
                </div>
                {latest ? (
                  <p className="muted" data-testid="latest-loc">
                    Latest: {latest.payload.lat.toFixed(5)}, {latest.payload.lon.toFixed(5)}
                    {latest.payload.accuracyM ? ` (within ${Math.round(latest.payload.accuracyM)} m)` : ""}, at{" "}
                    {new Date(latest.capturedAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="panel-empty">No location reported yet.</p>
                )}
                <LocationMap points={points} />
              </section>
              <section className="panel">
                <div className="panel-head">
                  <HistoryIcon size={18} />
                  <h2>Location history</h2>
                </div>
                {events.length === 0 ? (
                  <p className="panel-empty">Nothing yet.</p>
                ) : (
                  <ul className="history-list">
                    {events.map((e) => (
                      <li key={e.id}>
                        {new Date(e.capturedAt).toLocaleString()}: {e.payload.lat.toFixed(5)}, {e.payload.lon.toFixed(5)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {/* ------------------------------------------------------------- Apps */}
          {tab === "apps" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <AppWindow size={18} />
                  <h2>App usage today</h2>
                </div>
                {usage.length === 0 ? (
                  <p className="panel-empty">No app usage reported yet.</p>
                ) : (
                  <ul className="row-list" data-testid="usage">
                    {usage.map((u) => (
                      <li key={u.packageName} className="row-item">
                        <span className="row-icon">
                          <AppWindow size={16} />
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
                  <ShieldBan size={18} />
                  <h2>App limits</h2>
                </div>
                <p className="muted">A blocked app is sent back to the home screen whenever it's opened.</p>
                {knownApps.length === 0 ? (
                  <p className="panel-empty">No apps seen yet. They appear here once the phone reports usage.</p>
                ) : (
                  <ul className="row-list" data-testid="limits">
                    {knownApps.map((pkg) => {
                      const isBlocked = blocked.includes(pkg);
                      return (
                        <li key={pkg} className="limit-row">
                          <span className="row-icon">
                            <AppWindow size={16} />
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
            </>
          )}

          {/* ------------------------------------------------------------- Live */}
          {tab === "live" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <ScreenShare size={18} />
                  <h2>Live screen</h2>
                </div>
                <p className="muted">
                  The phone shows a notice while you watch, and the person approves screen sharing once on
                  the phone. Turn on Control to tap the phone by clicking the picture.
                </p>
                <LiveScreen deviceId={id} />
              </section>
              <section className="panel">
                <div className="panel-head">
                  <Lock size={18} />
                  <h2>Remote lock</h2>
                </div>
                <p className="muted">
                  Locking works once device admin is turned on in the Monitor app. Unlocking a PIN needs the
                  phone to be set up as a managed device.
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
            </>
          )}

          {/* ------------------------------------------------------------- Setup */}
          {tab === "setup" && (
            <section className={`panel setup ${setupComplete ? "complete" : ""}`} data-testid="setup">
              <div className="setup-head">
                <span className="setup-title">
                  <ListChecks size={20} />
                  {setupComplete ? "Setup complete" : "Finish setup"}
                </span>
                {perms && (
                  <span className={`setup-count ${setupComplete ? "ok" : ""}`}>
                    {setupOn} of {CAPABILITIES.length} on
                  </span>
                )}
              </div>

              {!perms ? (
                <p className="panel-empty">
                  Setup status hasn't been reported yet. Update the Monitor app on the phone to{" "}
                  <strong>v0.3.1 or newer</strong> and open it once, then check back here.
                </p>
              ) : (
                <>
                  <div className="setup-bar">
                    <span style={{ width: `${(setupOn / CAPABILITIES.length) * 100}%` }} />
                  </div>
                  <p className="setup-note">
                    {setupComplete
                      ? "Everything is on and reporting from the phone."
                      : "These turn on from the phone — they can't be switched on from here. Open Monitor on the phone to finish."}
                  </p>
                  <ul className="setup-list">
                    {setupCaps.map((cap) => {
                      const on = !!perms[cap.key];
                      return (
                        <li key={cap.key} className={`setup-row ${on ? "done" : "todo"}`}>
                          <span className="setup-ic">{on && <Check size={14} strokeWidth={3} />}</span>
                          <div className="setup-main">
                            <div className="setup-name">{cap.name}</div>
                            <div className="setup-desc">{cap.desc}</div>
                            {!on && cap.steps && <div className="setup-steps">{cap.steps}</div>}
                          </div>
                          <span className={`setup-state ${on ? "on" : "off"}`}>{on ? "On" : "Off"}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="setup-foot">
                    Last checked {new Date(statusEvt!.capturedAt).toLocaleString()}
                    {statusEvt!.payload.appVersion ? ` · Monitor ${statusEvt!.payload.appVersion}` : ""}
                  </p>
                </>
              )}
            </section>
          )}

          {/* ------------------------------------------------------------- Device */}
          {tab === "device" && (
            <section className="panel" data-testid="device-manage">
              <div className="panel-head">
                <Settings size={18} />
                <h2>Device</h2>
              </div>
              <dl className="facts">
                <dt>Paired</dt>
                <dd>{device?.pairedAt ? new Date(device.pairedAt).toLocaleString() : "Not yet"}</dd>
                <dt>Consent recorded</dt>
                <dd>{device?.consentAcceptedAt ? new Date(device.consentAcceptedAt).toLocaleString() : "Not yet"}</dd>
                <dt>Last seen</dt>
                <dd>{device?.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}</dd>
              </dl>
              <p className="muted">
                Re-link to pair the app again, for example after reinstalling it on the phone. Delete removes
                the device and everything it reported.
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
                <div className="card paircode" data-testid="relink-code" style={{ marginTop: "1.1rem", marginBottom: 0 }}>
                  <p>
                    On the phone, open the Monitor app and enter this code. The person using the phone confirms
                    they agree. The code expires in 15 minutes.
                  </p>
                  <div className="code-row">
                    <span className="code">{formatPairCode(pairCode)}</span>
                    <button className="secondary" onClick={() => navigator.clipboard?.writeText(pairCode)}>
                      <Copy size={14} />
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
