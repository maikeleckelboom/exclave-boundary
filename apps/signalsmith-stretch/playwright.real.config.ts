import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const appRoot = dirname(fileURLToPath(import.meta.url));
const requiredRealAdapterAssets = [
  [
    "generated Signalsmith module",
    join(appRoot, "generated", "signalsmith-stretch.module.js"),
  ],
  [
    "vendored Signalsmith Stretch metadata",
    join(appRoot, "vendor", "signalsmith-stretch", ".vendor-meta.json"),
  ],
  [
    "vendored Signalsmith Linear metadata",
    join(appRoot, "vendor", "signalsmith-linear", ".vendor-meta.json"),
  ],
] as const;
const missingRealAdapterAssets = requiredRealAdapterAssets
  .filter(([, filePath]) => !existsSync(filePath))
  .map(([label]) => label);

if (missingRealAdapterAssets.length > 0) {
  throw new Error(
    [
      `Missing Signalsmith real-adapter assets: ${missingRealAdapterAssets.join(", ")}.`,
      "Run pnpm --filter @exclave/signalsmith-stretch run prepare:real before using playwright.real.config.ts directly.",
      "The package test:browser:real script prepares these assets automatically.",
    ].join(" "),
  );
}

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
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:5176",
  },
});
