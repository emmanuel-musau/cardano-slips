import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "page",
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"]
  }
})
