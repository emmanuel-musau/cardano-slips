import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The project name the root config's `packages/*` glob picks up; it is
    // what `vitest --project server` and the run output call this suite.
    name: "server",
    include: ["test/**/*.test.ts"]
  }
})
