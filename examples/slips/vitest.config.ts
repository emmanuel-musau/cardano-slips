import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "example-slips",
    include: ["test/**/*.test.ts"]
  }
})
