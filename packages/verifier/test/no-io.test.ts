import { readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { extname, join, relative, resolve } from "node:path"
import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * Hard invariant 1, over the real code: `verifier` is a pure function of (tx
 * CBOR, declared metadata, user addresses, resolved inputs, protocol
 * parameters). An engine that fetches mid-derivation can be made slow, made to
 * fail, or made to answer wrongly by whoever benefits from the wrong answer.
 *
 * Two checks, because neither alone is enough. The scan reads every source file
 * and rejects any way in, including a branch no test enters. The trap loads the
 * module with every route out of the process poisoned.
 *
 * Non-determinism is a separate concern: derivation is handed its validity
 * interval rather than asked to compare it against now.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/**
 * The only list a widening goes through. No test can prove a dependency is
 * pure, so this is a recorded judgement and CODEOWNERS routes any edit to it.
 */
const allowedDependencies = ["@cardano-slips/core", "effect"]

/** Packages this one must never reach for, whatever else the list says. */
const forbiddenPackages = ["@cardano-slips/flow", "@cardano-slips/server"]

/** Globals that can leave the process without importing anything. */
const networkGlobals = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "process",
  "require"
]

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

/** Every `.ts` file under `src`, path-relative to the package root. */
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

type Reference = { file: string; what: string }

function walk(tree: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node)
    ts.forEachChild(node, step)
  }
  step(tree)
}

/** Every module specifier a file names. Regex would miss `import()` and trip over the word in a comment. */
function moduleSpecifiers(tree: ts.SourceFile): string[] {
  const found: string[] = []
  walk(tree, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
      return
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const reference = node.moduleReference.expression
      if (ts.isStringLiteral(reference)) found.push(reference.text)
      return
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === "require"
      const argument = node.arguments[0]
      if ((isDynamicImport || isRequire) && argument && ts.isStringLiteral(argument)) found.push(argument.text)
    }
  })
  return found
}

/** An identifier used as a value, rather than as somebody's property name. */
function isFreeIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  if (parent === undefined) return true
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isQualifiedName(parent) && parent.right === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === node
  ) {
    return false
  }
  return true
}

/** Names from `networkGlobals` used as values anywhere in the sources. */
function globalUses(): Reference[] {
  return sources.flatMap(({ path, tree }) => {
    const found: Reference[] = []
    walk(tree, (node) => {
      if (ts.isIdentifier(node) && networkGlobals.includes(node.text) && isFreeIdentifier(node)) {
        found.push({ file: path, what: node.text })
      }
    })
    return found
  })
}

const imports: Reference[] = sources.flatMap(({ path, tree }) =>
  moduleSpecifiers(tree).map((what) => ({ file: path, what }))
)

const bareImports = imports.filter(({ what }) => !what.startsWith(".") && !what.startsWith("/"))

describe("the sources", () => {
  it("has sources to read", () => {
    // Guards every assertion below from passing over an empty directory.
    expect(sources.length).toBeGreaterThan(0)
  })

  it("imports no node builtin", () => {
    // Bare spellings too: they resolve to the same modules and slip past a `node:` prefix check.
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
    const reaching = bareImports.filter(
      ({ what }) => builtins.has(what.split("/").slice(0, 2).join("/")) || builtins.has(what)
    )
    expect(reaching).toEqual([])
  })

  it("imports nothing from flow or server", () => {
    // The dependency direction from docs/ARCHITECTURE.md. `flow` owns the network layer.
    const crossing = imports.filter(({ what }) =>
      forbiddenPackages.some((name) => what === name || what.startsWith(`${name}/`))
    )
    expect(crossing).toEqual([])
  })

  it("imports only packages the manifest declares", () => {
    // A phantom dependency works locally and fails on a consumer's clean install.
    const undeclared = bareImports.filter(
      ({ what }) => !declaredDependencies.some((name) => what === name || what.startsWith(`${name}/`))
    )
    expect(undeclared).toEqual([])
  })

  it("stays inside the package", () => {
    const escaping = imports
      .filter(({ what }) => what.startsWith("."))
      .filter(({ file, what }) => {
        const target = resolve(join(packageRoot, file), "..", what)
        return !target.startsWith(`${sourceRoot}/`)
      })
    expect(escaping).toEqual([])
  })

  it("names no global that can leave the process", () => {
    // `fetch` and `navigator.sendBeacon` need no import; `process` is an ambient input.
    expect(globalUses()).toEqual([])
  })
})

describe("what the manifest declares", () => {
  it("carries no runtime dependency outside the reviewed list", () => {
    const unreviewed = declaredDependencies.filter((name) => !allowedDependencies.includes(name))
    expect(unreviewed).toEqual([])
  })

  it("declares neither flow nor server", () => {
    expect(declaredDependencies.filter((name) => forbiddenPackages.includes(name))).toEqual([])
  })
})

/** The runtime half: every builtin replaced with a recorder, so an import the scan missed still shows up. */
const io = { reached: [] as string[] }

/**
 * Built from the builtin's own export names: Vitest resolves named exports
 * against the factory's object, so a catch-all proxy would throw on the first
 * import instead of recording it. Recorders return rather than fail, so the
 * caller carries on and the whole list survives to the assertion.
 */
async function ioTrap(specifier: string, importOriginal: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const actual = (await importOriginal()) as Record<string, unknown>
  const trap: Record<string, unknown> = {}
  for (const name of Object.keys(actual)) {
    const value = actual[name]
    trap[name] =
      typeof value === "function"
        ? (..._arguments: unknown[]) => {
            io.reached.push(`${specifier}.${name}`)
            return undefined
          }
        : value
  }
  trap.default = trap
  return trap
}

/** `doMock`, not `mock`: this file reads sources with `node:fs`, and a hoisted mock would take that away. */
const trapped = [
  "node:fs",
  "node:fs/promises",
  "node:net",
  "node:tls",
  "node:http",
  "node:https",
  "node:http2",
  "node:dgram",
  "node:dns",
  "node:child_process",
  "node:worker_threads"
]

describe("the loaded module", () => {
  const original = new Map<string, unknown>()
  const ambient = globalThis as unknown as Record<string, unknown>

  beforeAll(async () => {
    for (const specifier of trapped) vi.doMock(specifier, (importOriginal) => ioTrap(specifier, importOriginal))

    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) {
      original.set(name, ambient[name])
      ambient[name] = (..._arguments: unknown[]) => {
        io.reached.push(`globalThis.${name}`)
        return undefined
      }
    }

    // Loading the module is itself a test: a top-level side effect runs here.
    const entry: Record<string, unknown> = await import("../src/index.js")

    // Then every export, so a call trips the trap rather than an import.
    for (const value of Object.values(entry)) {
      if (typeof value !== "function") continue
      try {
        ;(value as (...arguments_: unknown[]) => unknown)()
      } catch {
        // Throwing on bad arguments is fine: the recorder logged before it returned.
      }
    }
  })

  afterAll(() => {
    for (const specifier of trapped) vi.doUnmock(specifier)
    vi.resetModules()
    for (const [name, value] of original) {
      if (value === undefined) delete ambient[name]
      else ambient[name] = value
    }
  })

  it("touches no network global", () => {
    expect(io.reached.filter((call) => call.startsWith("globalThis."))).toEqual([])
  })

  it("opens no file, socket or request", () => {
    expect(io.reached.filter((call) => call.startsWith("node:"))).toEqual([])
  })
})
