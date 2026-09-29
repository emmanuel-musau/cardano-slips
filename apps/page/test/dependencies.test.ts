import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * The page reaches the protocol through `flow` and `core` only. `server` in a
 * browser bundle ships a publisher's endpoint code to everyone who opens a Slip,
 * and `verifier` is `flow`'s to call, so the page cannot skip the mismatch block.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

const forbiddenPackages = ["@cardano-slips/server", "@cardano-slips/verifier"]

const allowedDependencies = ["@cardano-slips/core", "@cardano-slips/flow", "effect", "next", "react", "react-dom"]

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

function sourceFiles(directory: string = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

/** Every module specifier a file names. Regex would miss `import()` and trip over the word in a comment. */
function moduleSpecifiers(tree: ts.SourceFile): string[] {
  const found: string[] = []
  const step = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments
      if (first !== undefined && ts.isStringLiteral(first)) found.push(first.text)
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

const imported = sourceFiles().flatMap((path) =>
  moduleSpecifiers(
    ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  ).map((specifier) => ({ file: relative(packageRoot, path), specifier }))
)

describe("the packages the page may never reach for", () => {
  it("declares them nowhere in the manifest", () => {
    expect(declaredDependencies.filter((dependency) => forbiddenPackages.includes(dependency))).toEqual([])
  })

  it("imports them nowhere in the sources", () => {
    const crossings = imported.filter(({ specifier }) => forbiddenPackages.includes(packageOf(specifier)))
    expect(crossings).toEqual([])
  })
})

describe("what the page does declare", () => {
  it("carries only dependencies this file has reviewed", () => {
    const unreviewed = declaredDependencies.filter((dependency) => !allowedDependencies.includes(dependency))
    expect(unreviewed).toEqual([])
  })

  it("imports nothing it has not declared", () => {
    const undeclared = imported
      .filter(({ specifier }) => !specifier.startsWith("."))
      .filter(({ specifier }) => !declaredDependencies.includes(packageOf(specifier)))
    expect(undeclared).toEqual([])
  })
})
