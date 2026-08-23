import { defineConfig, devices } from "@playwright/test";

const exploratoryMode = process.env.E2E_REAL_PROVIDER === "1" || Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: exploratoryMode ? 120_000 : 60_000,
  expect: {
    timeout: exploratoryMode ? 30_000 : 10_000
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "msedge" }
    }
  ]
});
