import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy API calls to the running API so the dashboard and API share an origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
});
