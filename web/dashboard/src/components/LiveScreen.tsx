import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getToken } from "../api.ts";

function wsBase(): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) || window.location.origin;
  return base.replace(/^http/, "ws");
}

/** Live screen viewer: streams JPEG frames from the phone and sends taps back for remote control. */
export function LiveScreen({ deviceId }: { deviceId: string }) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const [control, setControl] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const metaRef = useRef<{ w: number; h: number } | null>(null);

  function start() {
    const token = getToken();
    if (!token) return;
    const ws = new WebSocket(`${wsBase()}/v1/stream/viewer?deviceId=${deviceId}&token=${token}`);
    ws.binaryType = "arraybuffer";
    setStatus("Connecting…");
    ws.onopen = () => setStatus("Connected — waiting for the phone to share…");
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "meta") metaRef.current = { w: m.w, h: m.h };
          if (m.type === "status") setStatus(m.text ?? "");
        } catch {
          /* ignore */
        }
        return;
      }
      const url = URL.createObjectURL(new Blob([e.data as ArrayBuffer], { type: "image/jpeg" }));
      const img = imgRef.current;
      if (img) {
        const prev = img.src;
        img.src = url;
        if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      }
      setStatus("");
    };
    ws.onclose = () => {
      setActive(false);
      setStatus("Disconnected");
    };
    ws.onerror = () => setStatus("Connection error");
    wsRef.current = ws;
    setActive(true);
  }

  function stop() {
    wsRef.current?.close();
    wsRef.current = null;
    setActive(false);
    setStatus("");
  }

  function onImageClick(e: MouseEvent<HTMLImageElement>) {
    if (!control) return;
    const ws = wsRef.current;
    const meta = metaRef.current;
    const img = imgRef.current;
    if (!ws || !meta || !img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * meta.w);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * meta.h);
    ws.send(JSON.stringify({ type: "tap", x, y }));
  }

  useEffect(() => () => wsRef.current?.close(), []);

  return (
    <div>
      <div className="live-controls">
        {!active ? (
          <button onClick={start}>View screen</button>
        ) : (
          <button onClick={stop}>Stop</button>
        )}
        {active && (
          <label className="live-toggle">
            <input type="checkbox" checked={control} onChange={(e) => setControl(e.target.checked)} />
            Control (tap)
          </label>
        )}
        {status && <span className="muted">{status}</span>}
      </div>
      {active && (
        <img
          ref={imgRef}
          className={`live-img ${control ? "live-control" : ""}`}
          alt="Live screen"
          onClick={onImageClick}
          data-testid="live-img"
        />
      )}
    </div>
  );
}
