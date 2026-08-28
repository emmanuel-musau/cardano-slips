import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * `server` never imports `flow` or `verifier`. Reaching for `verifier` to check
 * an intent before returning it looks reasonable and is still wrong: the
 * comparison runs in the client, so an endpoint would be checking its own work.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/** Workspace packages this one must never reach for, in a manifest or in a source file. */
const forbiddenPackages = ["@cardano-slips/flow", "@cardano-slips/verifier"]

/**
 * What `server` may carry — widening it is a judgement CODEOWNERS routes. No
 * framework: the Next.js adapter is a peer dependency, because a second copy of
 * a publisher's framework is a bug we would have shipped them.
 */
const allowedDependencies = ["@cardano-slips/core", "effect"]

type Manifest = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
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

describe("the packages server may never reach for", () => {
  it("declares neither of them in the manifest", () => {
    expect(declaredDependencies.filter((dependency) => forbiddenPackages.includes(dependency))).toEqual([])
  })

  it("imports neither of them anywhere in the sources", () => {
    // The manifest is the promise; this is the code.
    const crossings = imported.filter(({ specifier }) => forbiddenPackages.includes(packageOf(specifier)))
    expect(crossings).toEqual([])
  })
})

describe("what server does declare", () => {
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
