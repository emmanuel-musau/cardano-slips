import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { describeDependencyRules, readManifest } from "../../../test/support/workspace.js"

/**
 * `flow` never imports `server` — a browser bundle would ship a publisher's
 * server code to everyone who opens a Slip — and React is a peer dependency,
 * never a dependency, since two copies in one page throw from the wrong one.
 */

/**
 * What `flow` may carry. Widening it is a judgement a test cannot settle, so it
 * is recorded here and CODEOWNERS routes the edit. React is listed because a
 * source file may import it; *where* it is declared is the React block below.
 */
const allowedDependencies = [
  "@cardano-slips/core",
  "@cardano-slips/verifier",
  "@cardano-slips/identity",
  "@evolution-sdk/evolution",
  // BLAKE2b-256 for the transaction id, which evolution-sdk computes nowhere
  // over a body's own bytes. Declared rather than reached for through
  // evolution-sdk, which carries it and owes us nothing.
  "@noble/hashes",
  "effect",
  "react"
]

const packageRoot = join(import.meta.dirname, "..")
const manifest = readManifest(packageRoot)

describeDependencyRules("flow", {
  packageRoot,
  forbidden: ["@cardano-slips/server"],
  allowed: allowedDependencies,
  nodeBuiltins: true
})

describe("React", () => {
  it("is a peer dependency and not a dependency", () => {
    // Breaks a consumer's page rather than our build: declaring React as a
    // dependency is how a second copy gets into their tree.
    expect(manifest.peerDependencies?.react).toBeDefined()
    expect(manifest.dependencies?.react).toBeUndefined()
    expect(manifest.optionalDependencies?.react).toBeUndefined()
  })

  it("is installed for our own tests, at a version the peer range accepts", () => {
    // A devDependency outside the peer range means the suite proves the
    // components work against a React no consumer is allowed to bring.
    const peer = manifest.peerDependencies?.react ?? ""
    const dev = manifest.devDependencies?.react ?? ""
    expect(dev).not.toBe("")
    const major = (range: string): string | undefined => /(\d+)\./.exec(range)?.[1]
    expect(major(dev)).toBe(major(peer))
  })
})
