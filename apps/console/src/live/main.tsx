import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "./live.css";
import { LivePage } from "./LivePage.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LivePage />
    </StrictMode>,
  );
}
