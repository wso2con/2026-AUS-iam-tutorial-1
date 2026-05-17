import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PLAYWRIGHT_PORT || 5175;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm --prefix frontend run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_ASGARDEO_BASE_URL: "https://api.asgardeo.io/t/e2e",
      VITE_ASGARDEO_CLIENT_ID: "wayfinder-e2e-client",
      VITE_ASGARDEO_ORG_NAME: "e2e",
      VITE_E2E_AUTH_MOCK: "true"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
