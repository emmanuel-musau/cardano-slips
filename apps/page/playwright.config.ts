import { defineConfig, devices } from "@playwright/test"

const pagePort = 3100
const examplesPort = 4011

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${pagePort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/serve-examples.ts",
      url: `http://localhost:${examplesPort}/tip`,
      reuseExistingServer: !process.env.CI
    },
    {
      // The scripted wallet's preview route exists only in a development build.
      command: `next dev --port ${pagePort}`,
      url: `http://localhost:${pagePort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000
    }
  ]
})
