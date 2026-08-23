import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The scaffold's own contract, copied from `core` because it is the pattern
 * every package carries: it proves the toolchain resolves the entry point end
 * to end, and that what the manifest promises npm is what the build actually
 * writes. A typo in an `exports` map is invisible until an installed consumer
 * fails to import — these assertions surface it here instead.
 *
 * What this package additionally has to be is in test/no-io.test.ts.
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

  it("is the only module the package exposes", () => {
    // Deep imports into `dist/` are not a supported surface: keeping the map
    // to the root subpath is what makes moving a file a non-breaking change.
    expect(Object.keys(manifest.exports ?? {})).toEqual([".", "./package.json"])
  })
})

describe("the published surface", () => {
  it("resolves its type declarations before any other condition", () => {
    // `types` last in the condition order is silently ignored by TypeScript
    // under `moduleResolution: NodeNext`, and the package then resolves to
    // `any` for every consumer.
    const root = manifest.exports?.["."]
    expect(typeof root).toBe("object")
    expect(Object.keys(root as Record<string, string>)[0]).toBe("types")
  })

  it("points every export at the directory the build writes", () => {
    const stray = exportTargets().filter((target) => !target.startsWith("./dist/") && target !== "./package.json")
    expect(stray).toEqual([])
  })

  it("has a source module behind each exported path", () => {
    // `./dist/index.js` and `./dist/index.d.ts` both come from `src/index.ts`.
    // Without this, a renamed source ships a manifest that points at nothing.
    const missing = exportTargets()
      .filter((target) => target.startsWith("./dist/"))
      .map((target) => target.replace(/^\.\/dist\//, "").replace(/\.d\.ts$|\.js$/, ".ts"))
      .filter((source) => !existsSync(join(packageRoot, "src", source)))
    expect(missing).toEqual([])
  })

  it("ships the build output and the sources its maps point at", () => {
    // The build emits declaration maps, and a map whose sources are missing
    // from the tarball sends a consumer's go-to-definition nowhere. npm adds
    // README, LICENSE and package.json on its own; nothing else belongs here.
    expect(manifest.files).toEqual(["dist", "src"])
  })

  it("declares itself ESM and free of side effects", () => {
    // A bundler drops unused imports from this package only if it is told the
    // module graph has no side effects to preserve.
    expect(manifest.type).toBe("module")
    expect(manifest.sideEffects).toBe(false)
  })
})
