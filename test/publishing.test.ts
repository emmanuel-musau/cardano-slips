import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * What reaches npm. Written against the workspace on disk, so a scaffolded
 * package that cannot be published fails here rather than at `changeset
 * publish` on main.
 */

const root = join(import.meta.dirname, "..")

/** Workspace roots, mirroring `pnpm-workspace.yaml`. */
const workspaceRoots = ["packages", "apps", "examples"] as const

/**
 * The packages that ship to npm (ADR-0005). `identity` is absent on purpose:
 * whether it exists at all is CIP-0170's go/no-go (#63).
 */
const publishable = ["@cardano-slips/core", "@cardano-slips/server", "@cardano-slips/verifier", "@cardano-slips/flow"]

type Manifest = {
  name?: string
  private?: boolean
  license?: string
  repository?: unknown
  publishConfig?: { access?: string }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type WorkspacePackage = {
  /** Path relative to the repo root, e.g. `packages/core`. */
  dir: string
  manifest: Manifest
}

function readWorkspacePackages(): WorkspacePackage[] {
  return workspaceRoots.flatMap((workspaceRoot) => {
    let entries: string[]
    try {
      entries = readdirSync(join(root, workspaceRoot))
    } catch {
      return [] // the directory does not exist yet
    }
    return entries.flatMap((entry) => {
      const dir = `${workspaceRoot}/${entry}`
      try {
        const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as Manifest
        return [{ dir, manifest }]
      } catch {
        return [] // not a package
      }
    })
  })
}

const workspacePackages = readWorkspacePackages()
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
