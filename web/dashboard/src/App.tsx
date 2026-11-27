import { useState } from "react";
import { Navigate, Route, Routes, Link, useNavigate, useLocation } from "react-router-dom";
import { Smartphone, LogOut, Moon, Sun, CircleHelp } from "lucide-react";
import { useAuth } from "./auth.tsx";
import { Login } from "./pages/Login.tsx";
import { Devices } from "./pages/Devices.tsx";
import { DeviceDetail } from "./pages/DeviceDetail.tsx";
import { Help } from "./pages/Help.tsx";
import { Logo } from "./components/Logo.tsx";
import { currentTheme, toggleTheme, type Theme } from "./theme.ts";

export function App() {
  const { authed, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [theme, setThemeState] = useState<Theme>(currentTheme);

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
            <Logo size={30} />
            Monitor
          </Link>
        </div>
        <nav className="sidebar-nav">
          <Link to="/devices" className={`nav-item ${onDevices ? "active" : ""}`} aria-label="Devices">
            <Smartphone size={17} />
            <span className="btn-label">Devices</span>
          </Link>
          <Link to="/help" className={`nav-item ${loc.pathname === "/help" ? "active" : ""}`} aria-label="Help">
            <CircleHelp size={17} />
            <span className="btn-label">Help</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
          <button
            className="secondary"
            onClick={() => setThemeState(toggleTheme())}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            <span className="btn-label">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          </button>
          <button
            className="secondary"
            onClick={() => {
              signOut();
              nav("/login");
            }}
            aria-label="Sign out"
          >
            <LogOut size={15} />
            <span className="btn-label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </main>
    </div>
  );
}
