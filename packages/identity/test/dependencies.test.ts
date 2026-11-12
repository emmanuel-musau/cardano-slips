import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")
const workspaceRoot = join(packageRoot, "..", "..")

/** Workspace packages this one must never reach for, in a manifest or in a source file. */
const forbiddenPackages = ["@cardano-slips/flow", "@cardano-slips/server", "@cardano-slips/verifier"]

/** What `identity` may carry. Widening it is a judgement CODEOWNERS routes. */
const allowedDependencies: ReadonlyArray<string> = []

/** The only workspace package allowed to depend on this one. */
const consumers = ["@cardano-slips/flow"]

type Manifest = {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const readManifest = (directory: string): Manifest =>
  JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Manifest

const manifest = readManifest(packageRoot)

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

/** Every module specifier a file names. */
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

/** Every workspace package's manifest, mirroring `pnpm-workspace.yaml`. */
function workspaceManifests(): Manifest[] {
  return ["packages", "apps", "examples"].flatMap((root) =>
    readdirSync(join(workspaceRoot, root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try {
          return [readManifest(join(workspaceRoot, root, entry.name))]
        } catch {
          return []
        }
      })
  )
}

describe("the packages identity may never reach for", () => {
  it("declares none of them in the manifest", () => {
    expect(declaredDependencies.filter((dependency) => forbiddenPackages.includes(dependency))).toEqual([])
  })

  it("imports none of them anywhere in the sources", () => {
    const crossings = imported.filter(({ specifier }) => forbiddenPackages.includes(packageOf(specifier)))
    expect(crossings).toEqual([])
  })
})

describe("what identity does declare", () => {
  it("carries only dependencies this file has reviewed", () => {
    const unreviewed = declaredDependencies.filter((dependency) => !allowedDependencies.includes(dependency))
    expect(unreviewed).toEqual([])
  })

  it("imports nothing it has not declared", () => {
    const undeclared = imported
      .filter(({ specifier }) => !specifier.startsWith("."))
      .filter(({ specifier }) => !specifier.startsWith("node:"))
      .filter(({ specifier }) => !declaredDependencies.includes(packageOf(specifier)))
    expect(undeclared).toEqual([])
  })
})

describe("who depends on identity", () => {
  it("is flow and nothing else in the workspace", () => {
    const dependents = workspaceManifests()
      .filter((other) =>
        Object.keys({
          ...other.dependencies,
          ...other.devDependencies,
          ...other.peerDependencies,
          ...other.optionalDependencies
        }).includes("@cardano-slips/identity")
      )
      .map((other) => other.name)
      .filter((name) => name === undefined || !consumers.includes(name))
    expect(dependents).toEqual([])
  })
})
