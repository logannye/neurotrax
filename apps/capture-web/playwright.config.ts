import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:4173/api/model-readiness",
    env: {
      ...process.env,
      OPENAI_API_KEY: "fixture-browser-test-key"
    },
    reuseExistingServer: true,
    timeout: 30_000
  }
});
