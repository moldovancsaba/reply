import { defineConfig } from "@playwright/test";

// Uses the Google Chrome already installed on the machine (no browser download). Each spec starts its own Reply Core service.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { channel: "chrome", headless: true, bypassCSP: true /* axe is injected as an inline script; the CSP itself is asserted separately */ },
});
