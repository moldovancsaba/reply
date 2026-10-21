import { defineConfig, devices } from "@playwright/test";

// Chrome is the Google Chrome already installed on the machine (no download); WebKit is Playwright's own build of Safari's
// engine (`npx playwright install webkit`, once), because the launcher opens Safari. Each spec starts its own Reply Core service.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { headless: true, bypassCSP: true /* axe is injected as an inline script; the CSP itself is asserted separately */ },
  projects: [
    { name: "chrome", use: { channel: "chrome" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
