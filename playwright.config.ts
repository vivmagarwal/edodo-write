import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser E2E tests. jsdom implements neither `document.execCommand` nor
 * real selection/typing, so everything interactive (input rules, Enter/Backspace
 * semantics, slash menu, toolbar, clipboard, drag, undo) is verified here
 * against the fixture page `e2e.html` served by the Vite dev server.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 20_000,
  use: {
    baseURL: "http://localhost:5283",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5283",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
