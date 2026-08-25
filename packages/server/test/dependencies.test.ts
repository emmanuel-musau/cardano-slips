import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * The dependency rule, over the real code.
 *
 * `docs/ARCHITECTURE.md` states it in one line: `server` never imports `flow`
 * or `verifier`. What that buys is small and easy to lose — a dApp that adds a
 * Slip endpoint installs one package and gets a request handler, not a React
 * tree it will never render and not a CBOR decoder it has no use for.
 *
 * It is easy to lose because both wrong imports look reasonable from inside a
 * pull request. Reaching for `verifier` to check an intent before returning it
 * is a tempting mistake with a real argument behind it, and it is still the
 * wrong package: the comparison that matters runs in the client, over the
 * bytes the wallet is about to be handed, and an endpoint that ran it too
 * would be checking its own work. Reaching for `flow` is the more ordinary
 * accident — a shared type, pulled in by a path nobody looked at.
 *
 * So the scan reads the sources rather than trusting the manifest. A
 * dependency can be undeclared and still imported, and the import is what
 * ends up in a consumer's install.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/** Workspace packages this one must never reach for, in a manifest or in a source file. */
const forbiddenPackages = ["@cardano-slips/flow", "@cardano-slips/verifier"]

/**
 * The runtime dependencies `server` is allowed to carry. Widening it is a
 * judgement rather than something a test can settle, so it is recorded here
 * and CODEOWNERS routes the edit for review. A framework is deliberately
 * absent: the Next.js adapter arrives with its own issue, and it arrives as a
 * peer dependency — a publisher already has their framework, and a second copy
 * of it in their tree is a bug we would have shipped them.
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

describe("the packages server may never reach for", () => {
  it("declares neither of them in the manifest", () => {
    expect(declaredDependencies.filter((dependency) => forbiddenPackages.includes(dependency))).toEqual([])
  })

  it("imports neither of them anywhere in the sources", () => {
    // The manifest is the promise; this is the code. A dependency can be
    // undeclared and imported all the same, and the import is what reaches a
    // consumer's install.
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
