import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1>Devices</h1>

      <form className="add-device" onSubmit={addDevice}>
        <input
          placeholder="Device name (e.g. Ada's phone)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">Add device</button>
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
        <p className="muted">No devices yet. Add one above.</p>
      ) : (
        <ul className="device-list">
          {devices.map((d) => (
            <li key={d.id} className="card device-row">
              <Link to={`/devices/${d.id}`} className="device-name">
                {d.name ?? "Unnamed device"}
              </Link>
              <span className={`badge ${d.pairedAt ? "ok" : "pending"}`}>
                {d.pairedAt ? "Paired" : "Awaiting pairing"}
              </span>
              <span className="muted">
                {d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "Never seen"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
