import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Smartphone, CheckCircle2, Clock, KeyRound } from "lucide-react";
import { api, type DeviceSummary } from "../api.ts";
import { initial, presence } from "../lib/format.ts";

export function Devices() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function refresh() {
    try {
      setDevices((await api.listDevices()).devices);
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
    const name = newName.trim() || "New device";
    const r = await api.createDevice(name);
    setPairCode(r.pairCode);
    setNewName("");
    refresh();
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
          placeholder="Name the phone, e.g. Ada's phone"
          aria-label="Device name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">
          <Plus size={16} />
          Add device
        </button>
      </form>

      {pairCode && (
        <div className="card paircode" data-testid="paircode">
          <p>
            On the phone, open the Monitor app and enter this code. The person using the phone
            confirms they agree to be monitored. The code expires in 15 minutes.
          </p>
          <div className="code">{pairCode}</div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {devices.length === 0 ? (
        <div className="empty-state">
          <Smartphone size={24} style={{ marginBottom: 8, opacity: 0.6 }} />
          <div>No devices yet. Name a phone above to get its pairing code.</div>
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
                      Agreed
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
