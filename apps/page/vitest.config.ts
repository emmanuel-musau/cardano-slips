import { defineConfig } from "vitest/config"

export default defineConfig({
  // `flow` resolves its own dev copy of React; one copy, or its hooks run against a dispatcher that is not there.
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    name: "page",
    environment: "happy-dom",
    // The page is served from an origin, and asks it for `/parameters/<network>`.
    environmentOptions: { happyDOM: { url: "http://localhost:3000/" } },
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"]
  }
})
