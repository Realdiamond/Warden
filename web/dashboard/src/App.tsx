import { Navigate, Route, Routes, Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth.tsx";
import { Login } from "./pages/Login.tsx";
import { Devices } from "./pages/Devices.tsx";
import { DeviceDetail } from "./pages/DeviceDetail.tsx";

export function App() {
  const { authed, signOut } = useAuth();
  const nav = useNavigate();

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/devices" className="brand">
          Monitor
        </Link>
        <button
          className="link"
          onClick={() => {
            signOut();
            nav("/login");
          }}
        >
          Sign out
        </button>
      </header>
      <main className="container">
        <Routes>
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </main>
    </div>
  );
}
