import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Vitest 4 replaced `vitest.workspace.ts` with this. A package's own
    // vitest.config.ts wins for anything it sets.
    projects: [
      // Invariants belonging to no package. Run by `pnpm test:repo`.
      {
        test: {
          name: "repo",
          root: import.meta.dirname,
          include: ["test/**/*.test.ts"]
        }
      },
      "packages/*",
      "apps/*",
      "examples/*"
    ],

    // Explicit imports over ambient globals; the base tsconfig ships `types: []`.
    globals: false,

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: ["**/dist/**", "**/test/**", "**/*.config.ts", "**/.tsbuildinfo/**"]
    }
  }
})
