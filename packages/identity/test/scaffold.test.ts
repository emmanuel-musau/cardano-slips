import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

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

  it("is the only module the package exposes", () => {
    expect(Object.keys(manifest.exports ?? {})).toEqual([".", "./package.json"])
  })
})

describe("the published surface", () => {
  it("resolves its type declarations before any other condition", () => {
    const root = manifest.exports?.["."]
    expect(typeof root).toBe("object")
    expect(Object.keys(root as Record<string, string>)[0]).toBe("types")
  })

  it("points every export at the directory the build writes", () => {
    const stray = exportTargets().filter((target) => !target.startsWith("./dist/") && target !== "./package.json")
    expect(stray).toEqual([])
  })

  it("has a source module behind each exported path", () => {
    const missing = exportTargets()
      .filter((target) => target.startsWith("./dist/"))
      .map((target) => target.replace(/^\.\/dist\//, "").replace(/\.d\.ts$|\.js$/, ".ts"))
      .filter((source) => !existsSync(join(packageRoot, "src", source)))
    expect(missing).toEqual([])
  })

  it("ships the build output and the sources its maps point at", () => {
    expect(manifest.files).toEqual(["dist", "src"])
  })

  it("declares itself ESM and free of side effects", () => {
    expect(manifest.type).toBe("module")
    expect(manifest.sideEffects).toBe(false)
  })
})
