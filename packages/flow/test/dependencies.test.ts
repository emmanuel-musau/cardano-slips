import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * Two dependency rules, failing in different places. `flow` never imports
 * `server`: a browser bundle pulling in a request handler would ship a
 * publisher's server code to everyone who opens a Slip. And React is a peer
 * dependency, never a dependency — two copies in one page throw from the copy
 * that did not render, with an error naming neither package.
 *
 * The scan reads the sources rather than the manifest: a dependency can be
 * undeclared and imported all the same.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/** Workspace packages this one must never reach for, in a manifest or in a source file. */
const forbiddenPackages = ["@cardano-slips/server"]

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
  "effect",
  "react"
]

type Manifest = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Manifest

const declaredDependencies = Object.keys({
  ...manifest.dependencies,
  ...manifest.peerDependencies,
  ...manifest.optionalDependencies
})

/** Every `.ts` file under `src`. */
function sourceFiles(directory: string = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && extname(entry.name) === ".ts" ? [path] : []
  })
}

const sources = sourceFiles().map((path) => ({
  path: relative(packageRoot, path),
  tree: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true)
}))

/** Every module specifier a file names. Regex would miss `import()` and trip over the word in a comment. */
function moduleSpecifiers(tree: ts.SourceFile): string[] {
  const found: string[] = []
  const step = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteral(node.moduleReference.expression)) found.push(node.moduleReference.expression.text)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === "require"
      const [first] = node.arguments
      if ((isDynamic || isRequire) && first !== undefined && ts.isStringLiteral(first)) found.push(first.text)
    }
    ts.forEachChild(node, step)
  }
  step(tree)
  return found
}

/** The package a specifier belongs to: `@scope/name` or `name`, ignoring any subpath. */
function packageOf(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

const imported = sources.flatMap(({ path, tree }) =>
  moduleSpecifiers(tree).map((specifier) => ({ file: path, specifier }))
)

describe("the package flow may never reach for", () => {
  it("declares it nowhere in the manifest", () => {
    expect(declaredDependencies.filter((dependency) => forbiddenPackages.includes(dependency))).toEqual([])
  })

  it("imports it nowhere in the sources", () => {
    // The manifest is the promise; this is the code.
    const crossings = imported.filter(({ specifier }) => forbiddenPackages.includes(packageOf(specifier)))
    expect(crossings).toEqual([])
  })
})

describe("what flow does declare", () => {
  it("carries only dependencies this file has reviewed", () => {
    const unreviewed = declaredDependencies.filter((dependency) => !allowedDependencies.includes(dependency))
    expect(unreviewed).toEqual([])
  })

  it("imports nothing it has not declared", () => {
    // A transitive package that happens to be installed resolves in this
    // workspace and is absent from a consumer's node_modules.
    const undeclared = imported
      .filter(({ specifier }) => !specifier.startsWith("."))
      .filter(({ specifier }) => !specifier.startsWith("node:"))
      .filter(({ specifier }) => !declaredDependencies.includes(packageOf(specifier)))
    expect(undeclared).toEqual([])
  })
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
