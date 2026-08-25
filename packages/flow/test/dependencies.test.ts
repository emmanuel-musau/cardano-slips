import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * The dependency rules, over the real code.
 *
 * Two of them, and they fail in different places.
 *
 * **`flow` never imports `server`.** The arrow runs the other way in
 * `docs/ARCHITECTURE.md` — `core ← server`, and `flow → verifier` — and a
 * browser bundle that pulled in a request handler would ship a publisher's
 * server code to every person who opens a Slip.
 *
 * **React is a peer dependency, never a dependency.** Two copies of React in
 * one page is the oldest breakage in the ecosystem: hooks throw from the copy
 * that did not render, and the error names neither package. Declaring it as a
 * dependency is how that happens, so the manifest is asserted here rather than
 * reviewed by eye.
 *
 * The import scan reads the sources rather than trusting the manifest. A
 * dependency can be undeclared and still imported, and the import is what
 * ends up in a consumer's install.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/** Workspace packages this one must never reach for, in a manifest or in a source file. */
const forbiddenPackages = ["@cardano-slips/server"]

/**
 * The runtime dependencies `flow` is allowed to carry. Widening it is a
 * judgement rather than something a test can settle, so it is recorded here
 * and CODEOWNERS routes the edit for review.
 *
 * `identity` and `@evolution-sdk/evolution` are named because the architecture
 * expects them and they are not declared yet: each arrives in the pull request
 * that first imports it, argued there rather than pre-approved here.
 *
 * React is on the list because a source file may import it; *where* it is
 * declared is a separate question, and the React block below is what holds it
 * to `peerDependencies`.
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

/**
 * Every module specifier a file names — static imports, `export … from`,
 * `import()`, and `require()`. Regex over the text would miss the last two and
 * trip over the word "import" in a comment, of which this package has several.
 */
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
    // The manifest is the promise; this is the code. A dependency can be
    // undeclared and imported all the same, and the import is what reaches a
    // consumer's install.
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
    // The one that breaks a consumer's page rather than our build. Two copies
    // of React in a tree throw from `useState` with an error that names
    // neither package, and declaring it as a dependency is how a second copy
    // gets there.
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
