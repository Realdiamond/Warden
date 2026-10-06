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
    // Two pages: the moderator console and the live-location page trusted contacts open.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        live: resolve(import.meta.dirname, "live.html"),
      },
    },
  },
  worker: { format: "es" },
  test: {
    environment: "jsdom",
  },
});
