import type { Dirent } from "node:fs"
import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

export const workspaceRoot = join(import.meta.dirname, "..", "..")

export type Manifest = {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export const readManifest = <M extends Manifest = Manifest>(directory: string): M =>
  JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as M

/** Every workspace package's directory and manifest, mirroring `pnpm-workspace.yaml`. */
export function workspacePackages(): Array<{ dir: string; manifest: Manifest }> {
  return ["packages", "apps", "examples"].flatMap((root) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(join(workspaceRoot, root), { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const dir = `${root}/${entry.name}`
        try {
          return [{ dir, manifest: readManifest(join(workspaceRoot, dir)) }]
        } catch {
          return []
        }
      })
  })
}

/** What a consumer installs with the package: everything but `devDependencies`. */
export const runtimeDependencies = (manifest: Manifest): string[] =>
  Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })

export type Source = { path: string; tree: ts.SourceFile }

/** Every `.ts` and `.tsx` file under `src`, parsed, with its path relative to the package root. */
export function parseSources(packageRoot: string, directory = join(packageRoot, "src")): Source[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return parseSources(packageRoot, path)
    const extension = extname(entry.name)
    if (!entry.isFile() || ![".ts", ".tsx"].includes(extension)) return []
    const kind = extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const tree = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, kind)
    return [{ path: relative(packageRoot, path), tree }]
  })
}

/** Every module specifier a file names. Regex would miss `import()` and trip over the word in a comment. */
export function moduleSpecifiers(tree: ts.SourceFile): string[] {
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

export const importsOf = (sources: ReadonlyArray<Source>): Array<{ file: string; specifier: string }> =>
  sources.flatMap(({ path, tree }) => moduleSpecifiers(tree).map((specifier) => ({ file: path, specifier })))

/** The package a specifier belongs to: `@scope/name` or `name`, ignoring any subpath. */
export function packageOf(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

export type DependencyRules = {
  packageRoot: string
  /** Workspace packages this one must never reach for, in a manifest or in a source file. */
  forbidden: ReadonlyArray<string>
  /** What the package may carry. Widening it is a judgement CODEOWNERS routes. */
  allowed: ReadonlyArray<string>
  /** Whether `node:` builtins may be imported without a declaration. */
  nodeBuiltins: boolean
}

/** The checks every package's dependency test shares: what it never reaches for, and what it declares. */
export function describeDependencyRules(
  name: string,
  rules: DependencyRules
): ReadonlyArray<{ file: string; specifier: string }> {
  const declared = runtimeDependencies(readManifest(rules.packageRoot))
  const sources = parseSources(rules.packageRoot)
  const imported = importsOf(sources)

  describe(`the packages ${name} may never reach for`, () => {
    it("has sources to read", () => {
      expect(sources.length).toBeGreaterThan(0)
    })

    it("declares none of them in the manifest", () => {
      expect(declared.filter((dependency) => rules.forbidden.includes(dependency))).toEqual([])
    })

    it("imports none of them anywhere in the sources", () => {
      const crossings = imported.filter(({ specifier }) => rules.forbidden.includes(packageOf(specifier)))
      expect(crossings).toEqual([])
    })
  })

  describe(`what ${name} declares`, () => {
    it("carries only dependencies this file has reviewed", () => {
      expect(declared.filter((dependency) => !rules.allowed.includes(dependency))).toEqual([])
    })

    it("imports nothing it has not declared", () => {
      // A transitive package that happens to be installed resolves in this
      // workspace and is absent from a consumer's node_modules.
      const undeclared = imported
        .filter(({ specifier }) => !specifier.startsWith("."))
        .filter(({ specifier }) => !(rules.nodeBuiltins && specifier.startsWith("node:")))
        .filter(({ specifier }) => !declared.includes(packageOf(specifier)))
      expect(undeclared).toEqual([])
    })
  })

  return imported
}
