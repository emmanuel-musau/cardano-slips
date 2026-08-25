import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "flow",

    // happy-dom over jsdom for start-up cost: these are the most-run component
    // tests in the repo, and a suite people wait on is a suite people skip.
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"]
  }
})
