import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Smartphone, CheckCircle2, Clock, KeyRound, ListChecks } from "lucide-react";
import { api, type DeviceSummary, type EventEnvelope, type StatusPayload } from "../api.ts";
import { formatPairCode, initial, presence } from "../lib/format.ts";

// Capabilities counted in the setup chip. `run` is the "is the service actually running" key — a
// granted-but-paused service counts as not on, matching the device's Setup tab.
const SETUP_KEYS: { key: keyof NonNullable<StatusPayload["permissions"]>; run?: keyof NonNullable<StatusPayload["permissions"]> }[] = [
  { key: "location" },
  { key: "usage" },
  { key: "deviceAdmin" },
  { key: "batteryUnrestricted" },
  { key: "notifications", run: "notificationsRunning" },
  { key: "accessibility", run: "accessibilityRunning" },
];

export function Devices() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [setup, setSetup] = useState<Record<string, { on: number; total: number } | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const list = (await api.listDevices()).devices;
      setDevices(list);
      const entries = await Promise.all(
        list.map(async (d) => {
          try {
            const s = await api.getEvents(d.id, "status", 1);
            const perms = (s.events[0] as EventEnvelope<StatusPayload> | undefined)?.payload.permissions;
            if (!perms) return [d.id, null] as const;
            const on = SETUP_KEYS.filter((c) => perms[c.key] && !(c.run && perms[c.run] === false)).length;
            return [d.id, { on, total: SETUP_KEYS.length }] as const;
          } catch {
            return [d.id, null] as const;
          }
        }),
      );
      setSetup(Object.fromEntries(entries));
    } catch {
      setError("Could not load devices. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  async function addDevice(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      const name = newName.trim() || "New device";
      const r = await api.createDevice(name);
      setPairCode(r.pairCode);
      setNewName("");
      refresh();
    } catch {
      setError("Could not add the device. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        Loading devices…
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Devices</h1>
        <p>The phones you look after. Open one to see its chats, calls, location and more.</p>
      </div>

      <form className="add-device" onSubmit={addDevice}>
        <input
          ref={nameRef}
          placeholder="Name the phone, e.g. Ada's phone"
          aria-label="Device name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={adding}>
          {!adding && <Plus size={16} />}
          {adding ? "Adding…" : "Add device"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {pairCode && (
        <div className="card paircode" data-testid="paircode">
          <p>
            On the phone, open the Andsv app and enter this code. The person using the phone
            confirms they agree to be monitored. The code expires in 15 minutes.
          </p>
          <div className="code">{formatPairCode(pairCode)}</div>
        </div>
      )}

      {devices.length === 0 ? (
        <div className="empty-state">
          <Smartphone size={24} style={{ marginBottom: 8, opacity: 0.6 }} />
          <p style={{ margin: "0 0 1rem" }}>
            No devices yet. Add the first phone to get a pairing code, then install the Andsv app on
            it and enter the code.
          </p>
          <button onClick={() => nameRef.current?.focus()}>
            <Plus size={16} />
            Add your first device
          </button>
        </div>
      ) : (
        <div className="device-grid">
          {devices.map((d) => {
            const p = presence(d.lastSeenAt);
            return (
              <Link to={`/devices/${d.id}`} key={d.id} className="device-card">
                <div className="device-card-top">
                  <span className="device-icon">{initial(d.name ?? "?")}</span>
                  <div>
                    <div className="device-card-name">{d.name ?? "Unnamed device"}</div>
                    <div className={`presence ${p.live ? "live" : ""}`} style={{ margin: 0, fontSize: "0.86rem" }}>
                      <span className="presence-dot" />
                      {p.label}
                    </div>
                  </div>
                </div>
                <div className="status-row" style={{ marginTop: 0 }}>
                  <span className={`badge ${d.pairedAt ? "ok" : "pending"}`}>
                    {d.pairedAt ? <CheckCircle2 /> : <Clock />}
                    {d.pairedAt ? "Paired" : "Waiting for the phone"}
                  </span>
                  {d.consentAcceptedAt && (
                    <span className="badge">
                      <KeyRound />
                      Consent recorded
                    </span>
                  )}
                  {setup[d.id] && setup[d.id]!.on < setup[d.id]!.total && (
                    <span className="badge setup-chip">
                      <ListChecks />
                      Setup {setup[d.id]!.on}/{setup[d.id]!.total}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
