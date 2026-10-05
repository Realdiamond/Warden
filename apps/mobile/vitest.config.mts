import { defineConfig } from "vitest/config";

// Unit tests cover the plain TypeScript logic (no React Native imports).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
