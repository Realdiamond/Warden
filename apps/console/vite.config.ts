import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin in development too: the console reaches the API through this proxy.
    proxy: { "/v1": "http://localhost:8080" },
  },
  build: { sourcemap: false },
  worker: { format: "es" },
  test: {
    environment: "jsdom",
  },
});
