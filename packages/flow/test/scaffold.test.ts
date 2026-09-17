import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The scaffold's own contract, copied from `core`: a typo in an `exports` map
 * is invisible until an installed consumer fails to import.
 */

const packageRoot = join(import.meta.dirname, "..")

type Manifest = {
  type?: string
  sideEffects?: boolean | string[]
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
    // One module entry is what makes moving a source file non-breaking. The
    // stylesheets are the other subpaths because a stylesheet cannot be
    // re-exported through a module — and they stay not-modules below.
    const subpaths = Object.keys(manifest.exports ?? {})
    expect(subpaths.filter((subpath) => !subpath.endsWith(".css"))).toEqual([".", "./package.json"])
    expect(subpaths.filter((subpath) => subpath.endsWith(".css"))).toEqual(["./card.css", "./tokens.css"])

    const modules = exportTargets().filter((target) => target.endsWith(".js") || target.endsWith(".d.ts"))
    expect(modules).toEqual(["./dist/index.d.ts", "./dist/index.js"])
  })

  it("exposes every stylesheet it ships", () => {
    // A stylesheet in `src` that the map does not name is one a consumer cannot
    // import, which makes it dead weight nobody notices.
    const shipped = readdirSync(join(packageRoot, "src")).filter((name) => name.endsWith(".css"))
    const exposed = Object.keys(manifest.exports ?? {})
      .filter((subpath) => subpath.endsWith(".css"))
      .map((subpath) => subpath.replace(/^\.\//, ""))

    expect([...exposed].sort()).toEqual([...shipped].sort())
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
    // A bundler only drops unused imports if told the module graph has no side
    // effects — but a stylesheet is nothing but its side effect, and `false`
    // here lets webpack drop `import "@cardano-slips/flow/card.css"` and serve
    // an unstyled card. The modules stay shakeable; the stylesheets are named out.
    expect(manifest.type).toBe("module")
    expect(manifest.sideEffects).toEqual(["*.css"])
  })
})
