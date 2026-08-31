import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The scaffold's own contract, copied from `core`: a typo in an `exports` map
 * is invisible until an installed consumer fails to import.
 */

const packageRoot = join(import.meta.dirname, "..")

type Manifest = {
  type?: string
  sideEffects?: boolean
  types?: string
  files?: string[]
  exports?: Record<string, string | Record<string, string>>
}

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Manifest

/** Every distinct file path the `exports` map points at. */
function exportTargets(): string[] {
  return Object.values(manifest.exports ?? {}).flatMap((entry) =>
    typeof entry === "string" ? [entry] : Object.values(entry)
  )
}

describe("the public entry point", () => {
  it("loads", async () => {
    const entry = await import("../src/index.js")
    expect(entry).toBeTypeOf("object")
  })

  it("exposes the root and the Node bridge, and nothing else", () => {
    // A closed map is what makes moving a file non-breaking. The bridge is its
    // own entry so the root carries no Node types for a runtime that has none.
    expect(Object.keys(manifest.exports ?? {})).toEqual([".", "./package.json", "./adapters/node"])
  })
})

describe("the published surface", () => {
  it("resolves its type declarations before any other condition", () => {
    // `types` last is silently ignored under NodeNext, and the package then
    // resolves to `any` for every consumer.
    const root = manifest.exports?.["."]
    expect(typeof root).toBe("object")
    expect(Object.keys(root as Record<string, string>)[0]).toBe("types")
  })

  it("points every export at the directory the build writes", () => {
    const stray = exportTargets().filter((target) => !target.startsWith("./dist/") && target !== "./package.json")
    expect(stray).toEqual([])
  })

  it("has a source module behind each exported path", () => {
    // Without this, a renamed source ships a manifest pointing at nothing.
    const missing = exportTargets()
      .filter((target) => target.startsWith("./dist/"))
      .map((target) => target.replace(/^\.\/dist\//, "").replace(/\.d\.ts$|\.js$/, ".ts"))
      .filter((source) => !existsSync(join(packageRoot, "src", source)))
    expect(missing).toEqual([])
  })

  it("ships the build output and the sources its maps point at", () => {
    // A declaration map whose sources are missing from the tarball sends a
    // consumer's go-to-definition nowhere.
    expect(manifest.files).toEqual(["dist", "src"])
  })

  it("declares itself ESM and free of side effects", () => {
    // A bundler only drops unused imports if told the module graph has no side effects.
    expect(manifest.type).toBe("module")
    expect(manifest.sideEffects).toBe(false)
  })
})
