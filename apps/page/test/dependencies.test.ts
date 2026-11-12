import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { describeDependencyRules, importsOf, packageOf, parseSources } from "../../../test/support/workspace.js"

/**
 * The page reaches the protocol through `flow` and `core` only. `server` in a
 * browser bundle ships a publisher's endpoint code to everyone who opens a Slip,
 * and `verifier` is `flow`'s to call, so the page cannot skip the mismatch block.
 */

const packageRoot = join(import.meta.dirname, "..")

const allowedDependencies = [
  "@cardano-slips/core",
  "@cardano-slips/flow",
  "@evolution-sdk/evolution",
  "effect",
  "next",
  "react",
  "react-dom"
]

/** The only place the page talks to a chain provider: its own server route (ADR-0015). */
const providerRoute = join("src", "app", "parameters")

describeDependencyRules("the page", {
  packageRoot,
  forbidden: ["@cardano-slips/server", "@cardano-slips/verifier"],
  allowed: allowedDependencies,
  nodeBuiltins: false
})

const imported = importsOf(parseSources(packageRoot))

describe("the chain provider", () => {
  it("is reached only from the page's own parameters route, never from browser code", () => {
    const outside = imported
      .filter(({ specifier }) => packageOf(specifier) === "@evolution-sdk/evolution")
      .filter(({ file }) => !file.startsWith(providerRoute))
    expect(outside).toEqual([])
  })
})
