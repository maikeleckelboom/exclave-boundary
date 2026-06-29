import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: "test-results/browser",
  reporter: [["list"]],
  testDir: "tests/browser",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5175",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5175 --strictPort",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:5175",
  },
});
