import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Manifest as WorkspaceManifest } from "./support/workspace.js"
import { workspacePackages as listWorkspacePackages, workspaceRoot as root } from "./support/workspace.js"

/**
 * What reaches npm. Written against the workspace on disk, so a scaffolded
 * package that cannot be published fails here rather than at `changeset
 * publish` on main.
 */

/** The packages that ship to npm (ADR-0005, ADR-0016). */
const publishable = [
  "@cardano-slips/core",
  "@cardano-slips/server",
  "@cardano-slips/verifier",
  "@cardano-slips/identity",
  "@cardano-slips/flow"
]

type Manifest = WorkspaceManifest & {
  license?: string
  repository?: unknown
  publishConfig?: { access?: string }
  type?: string
  sideEffects?: boolean | string[]
  files?: string[]
  exports?: Record<string, string | Record<string, string>>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type WorkspacePackage = {
  /** Path relative to the repo root, e.g. `packages/core`. */
  dir: string
  manifest: Manifest
}

const workspacePackages = listWorkspacePackages() as WorkspacePackage[]
const published = workspacePackages.filter((pkg) => pkg.manifest.private !== true)
const privateNames = new Set(
  workspacePackages.filter((pkg) => pkg.manifest.private === true).map((pkg) => pkg.manifest.name)
)

describe("what reaches npm", () => {
  it("publishes only the packages the decision records name", () => {
    const unexpected = published
      .map((pkg) => pkg.manifest.name)
      .filter((name) => name === undefined || !publishable.includes(name))
    expect(unexpected).toEqual([])
  })

  it("publishes every package the decision records name", () => {
    const missing = publishable.filter((name) => !published.some((pkg) => pkg.manifest.name === name))
    expect(missing).toEqual([])
  })

  it("keeps apps and examples out of the registry", () => {
    const leaked = workspacePackages
      .filter((pkg) => pkg.dir.startsWith("apps/") || pkg.dir.startsWith("examples/"))
      .filter((pkg) => pkg.manifest.private !== true)
      .map((pkg) => pkg.dir)
    expect(leaked).toEqual([])
  })
})

describe("every published package", () => {
  // One assertion over a collected report rather than `it.each`, which Vitest
  // fails outright when the list is empty.
  it("is publishable as configured", () => {
    const misconfigured = published.flatMap((pkg) => {
      const problems: string[] = []
      // Scoped packages default to `restricted`, so the first publish 402s without this.
      if (pkg.manifest.publishConfig?.access !== "public") {
        problems.push('publishConfig.access must be "public"')
      }
      if (!pkg.manifest.name?.startsWith("@cardano-slips/")) {
        problems.push("name must be under the @cardano-slips scope")
      }
      if (pkg.manifest.license !== "MIT") problems.push("license must be MIT")
      if (pkg.manifest.repository === undefined) problems.push("repository is missing")
      return problems.length > 0 ? [{ dir: pkg.dir, problems }] : []
    })
    expect(misconfigured).toEqual([])
  })

  it("does not depend on an unpublished workspace package", () => {
    // `pnpm publish` rewrites `workspace:^` into a real range, which a consumer's
    // install then hunts for on the registry.
    const broken = published.flatMap((pkg) => {
      const shipped = {
        ...pkg.manifest.dependencies,
        ...pkg.manifest.peerDependencies,
        ...pkg.manifest.optionalDependencies
      }
      const unpublished = Object.keys(shipped).filter((dep) => privateNames.has(dep))
      return unpublished.length > 0 ? [{ dir: pkg.dir, unpublished }] : []
    })
    expect(broken).toEqual([])
  })
})

/** The module subpaths each package exposes. A closed map is what makes moving a file non-breaking. */
const moduleSubpaths: Record<string, string[]> = {
  "@cardano-slips/core": [".", "./package.json"],
  // The Node bridge is its own entry so the root carries no Node types for a runtime that has none.
  "@cardano-slips/server": [".", "./package.json", "./adapters/node"],
  "@cardano-slips/verifier": [".", "./package.json"],
  "@cardano-slips/identity": [".", "./package.json"],
  "@cardano-slips/flow": [".", "./package.json"]
}

/** Every distinct file path an `exports` map points at. */
const exportTargets = (manifest: Manifest): string[] =>
  Object.values(manifest.exports ?? {}).flatMap((entry) => (typeof entry === "string" ? [entry] : Object.values(entry)))

/** Stylesheets in a package's `src`; a stylesheet cannot be re-exported through a module, so each is its own subpath. */
const stylesheets = (pkg: WorkspacePackage): string[] =>
  readdirSync(join(root, pkg.dir, "src")).filter((name) => name.endsWith(".css"))

const byName = (name: string): WorkspacePackage => {
  const pkg = published.find((candidate) => candidate.manifest.name === name)
  if (pkg === undefined) throw new Error(`${name} is not in the workspace`)
  return pkg
}

// An `exports` typo is invisible until an installed consumer fails to import.
describe.each(publishable)("%s", (name) => {
  const pkg = byName(name)
  const { manifest } = pkg

  it("exposes only the module subpaths listed here", () => {
    const modules = Object.keys(manifest.exports ?? {}).filter((subpath) => !subpath.endsWith(".css"))
    expect(modules).toEqual(moduleSubpaths[name])
  })

  it("exposes every stylesheet it ships, and no other", () => {
    const exposed = Object.keys(manifest.exports ?? {})
      .filter((subpath) => subpath.endsWith(".css"))
      .map((subpath) => subpath.replace(/^\.\//, ""))
    expect([...exposed].sort()).toEqual(stylesheets(pkg).sort())
  })

  it("points every stylesheet subpath at a stylesheet", () => {
    const wrong = Object.entries(manifest.exports ?? {})
      .filter(([subpath]) => subpath.endsWith(".css"))
      .filter(([subpath, target]) => target !== `./dist/${subpath.replace(/^\.\//, "")}`)
    expect(wrong).toEqual([])
  })

  it("resolves type declarations before any other condition", () => {
    // `types` last is silently ignored under NodeNext, and the package then resolves to `any`.
    const entry = manifest.exports?.["."]
    expect(typeof entry).toBe("object")
    expect(Object.keys(entry as Record<string, string>)[0]).toBe("types")
  })

  it("points every export at the directory the build writes", () => {
    const stray = exportTargets(manifest).filter(
      (target) => !target.startsWith("./dist/") && target !== "./package.json"
    )
    expect(stray).toEqual([])
  })

  it("has a source file behind each exported path", () => {
    const missing = exportTargets(manifest)
      .filter((target) => target.startsWith("./dist/"))
      .map((target) => target.replace(/^\.\/dist\//, "").replace(/\.d\.ts$|\.js$/, ".ts"))
      .filter((source) => !existsSync(join(root, pkg.dir, "src", source)))
    expect(missing).toEqual([])
  })

  it("ships the build output and the sources its maps point at", () => {
    // A declaration map whose sources are missing from the tarball sends go-to-definition nowhere.
    expect(manifest.files).toEqual(["dist", "src"])
  })

  it("declares itself ESM, with side effects only in its stylesheets", () => {
    // `false` would let a bundler drop `import "@cardano-slips/flow/card.css"` and serve an unstyled card.
    expect(manifest.type).toBe("module")
    expect(manifest.sideEffects).toEqual(stylesheets(pkg).length > 0 ? ["*.css"] : false)
  })
})

describe("the release configuration", () => {
  const config = JSON.parse(readFileSync(join(root, ".changeset", "config.json"), "utf8")) as {
    access?: string
    baseBranch?: string
    linked?: unknown[]
    fixed?: unknown[]
  }

  it("publishes to the public registry", () => {
    expect(config.access).toBe("public")
  })

  it("versions from main", () => {
    expect(config.baseBranch).toBe("main")
  })

  it("keeps package versions independent", () => {
    // A fix in `verifier` must not force a `flow` release.
    expect(config.linked).toEqual([])
    expect(config.fixed).toEqual([])
  })
})
