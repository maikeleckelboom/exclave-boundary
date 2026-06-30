import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  metadata: {
    signalsmithRuntime: "real-adapter",
  },
  outputDir: "test-results/browser-real",
  reporter: [["list"]],
  testDir: "tests/browser",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5176",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm exec vite --mode real-adapter --host 127.0.0.1 --port 5176 --strictPort",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:5176",
  },
});
