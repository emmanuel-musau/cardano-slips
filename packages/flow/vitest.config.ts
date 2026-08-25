import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The project name the root config's `packages/*` glob picks up; it is
    // what `vitest --project flow` and the run output call this suite.
    name: "flow",

    // The only package whose tests need a document. happy-dom rather than
    // jsdom for the start-up cost: the effects panel and the mismatch block
    // are the most-run component tests in the repo, and a suite people wait
    // on is a suite people skip.
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"]
  }
})
