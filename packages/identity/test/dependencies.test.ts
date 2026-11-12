import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { describeDependencyRules, runtimeDependencies, workspacePackages } from "../../../test/support/workspace.js"

/** The only workspace package allowed to depend on this one. */
const consumers = ["@cardano-slips/flow"]

describeDependencyRules("identity", {
  packageRoot: join(import.meta.dirname, ".."),
  forbidden: ["@cardano-slips/flow", "@cardano-slips/server", "@cardano-slips/verifier"],
  allowed: [],
  nodeBuiltins: true
})

describe("who depends on identity", () => {
  it("is flow and nothing else in the workspace", () => {
    const dependents = workspacePackages()
      .filter(({ manifest }) =>
        [...runtimeDependencies(manifest), ...Object.keys(manifest.devDependencies ?? {})].includes(
          "@cardano-slips/identity"
        )
      )
      .map(({ manifest }) => manifest.name)
      .filter((name) => name === undefined || !consumers.includes(name))
    expect(dependents).toEqual([])
  })
})
