import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    // Match Vite’s default bind and README CORS allowlist (localhost, not 127.0.0.1).
    baseURL: "http://localhost:5173",
    headless: true,
  },
});
