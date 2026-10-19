import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the API is the Reply Core service on loopback; in production the service serves this build itself.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:45511" } },
  // The design system is one shared chunk (about 190 KB gzipped); the budget is enforced by a test, so the default 500 KB warning is raised.
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 800 },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
