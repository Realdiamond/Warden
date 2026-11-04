import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "./legal.css";
import { LegalPage } from "./LegalPage.tsx";

const root = document.getElementById("root");
if (root) {
  const doc = root.dataset.doc === "terms" ? "terms" : "privacy";
  createRoot(root).render(
    <StrictMode>
      <LegalPage doc={doc} />
    </StrictMode>,
  );
}
