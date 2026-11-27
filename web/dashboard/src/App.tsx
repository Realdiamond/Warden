import { Navigate, Route, Routes, Link, useNavigate, useLocation } from "react-router-dom";
import { ShieldCheck, Smartphone, LogOut } from "lucide-react";
import { useAuth } from "./auth.tsx";
import { Login } from "./pages/Login.tsx";
import { Devices } from "./pages/Devices.tsx";
import { DeviceDetail } from "./pages/DeviceDetail.tsx";

export function App() {
  const { authed, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const onDevices = loc.pathname.startsWith("/devices");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link to="/devices" className="brand">
            <span className="brand-mark">
              <ShieldCheck size={16} strokeWidth={2.4} />
            </span>
            Monitor
          </Link>
        </div>
        <nav className="sidebar-nav">
          <Link to="/devices" className={`nav-item ${onDevices ? "active" : ""}`}>
            <Smartphone size={16} />
            Devices
          </Link>
        </nav>
        <div className="sidebar-footer">
          <button
            className="secondary"
            onClick={() => {
              signOut();
              nav("/login");
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </main>
    </div>
  );
}
