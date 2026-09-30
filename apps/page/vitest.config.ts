import { defineConfig } from "vitest/config"

export default defineConfig({
  // `flow` resolves its own dev copy of React; one copy, or its hooks run against a dispatcher that is not there.
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    name: "page",
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"]
  }
})
