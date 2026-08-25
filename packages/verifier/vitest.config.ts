import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "verifier",
    include: ["test/**/*.test.ts"]
  }
})
