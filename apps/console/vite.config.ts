import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin in development too: the console reaches the API through this proxy.
    proxy: { "/v1": "http://localhost:8080" },
  },
  build: {
    sourcemap: false,
    // The moderator console, the live-location page trusted contacts open, and the public legal pages.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        live: resolve(import.meta.dirname, "live.html"),
        // The public privacy notice and terms of use (M11), which the Play Store links to.
        privacy: resolve(import.meta.dirname, "privacy.html"),
        terms: resolve(import.meta.dirname, "terms.html"),
      },
    },
  },
  worker: { format: "es" },
  test: {
    environment: "jsdom",
  },
});
