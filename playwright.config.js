import { defineConfig } from "@playwright/test";

// Extensions need a persistent context, so each spec drives its own browser.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "chromium", use: { browserChannel: "chromium" } },
    { name: "edge", use: { browserChannel: "msedge" } }
  ]
});
