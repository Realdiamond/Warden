import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Smartphone, CheckCircle2, Clock, KeyRound } from "lucide-react";
import { api, type DeviceSummary } from "../api.ts";

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
      setError("Could not load devices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
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
        <div className="page-header-text">
          <h1>Devices</h1>
          <p>Everything your family's monitored phones are reporting, in one place.</p>
        </div>
      </div>

      <form className="add-device" onSubmit={addDevice}>
        <input
          placeholder="Device name (e.g. Ada's phone)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">
          <Plus size={15} />
          Add device
        </button>
      </form>

      {pairCode && (
        <div className="card paircode" data-testid="paircode">
          <p>
            On the monitored phone, open the Monitor app and enter this pairing code. The person
            using that phone confirms they agree to be monitored. The code expires in 15 minutes.
          </p>
          <div className="code">{pairCode}</div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {devices.length === 0 ? (
        <div className="empty-state">
          <Smartphone size={22} style={{ marginBottom: 8, opacity: 0.6 }} />
          <div>No devices yet. Add one above to get a pairing code.</div>
        </div>
      ) : (
        <div className="device-grid">
          {devices.map((d) => (
            <Link to={`/devices/${d.id}`} key={d.id} className="device-card">
              <div className="device-card-top">
                <span className="device-icon">
                  <Smartphone size={17} />
                </span>
                <div>
                  <div className="device-card-name">{d.name ?? "Unnamed device"}</div>
                  <div className="device-card-meta">
                    {d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "Never seen"}
                  </div>
                </div>
              </div>
              <div className="status-row">
                <span className={`badge ${d.pairedAt ? "ok" : "pending"}`}>
                  {d.pairedAt ? <CheckCircle2 /> : <Clock />}
                  {d.pairedAt ? "Paired" : "Awaiting pairing"}
                </span>
                {d.consentAcceptedAt && (
                  <span className="badge neutral">
                    <KeyRound />
                    Consented
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
