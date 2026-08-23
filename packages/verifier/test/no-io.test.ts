import { readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { extname, join, relative, resolve } from "node:path"
import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * Hard invariant 1, over the real code.
 *
 * `verifier` is a pure function of (tx CBOR, declared metadata, user
 * addresses, resolved inputs, protocol parameters). The repo-level
 * test/verifier-signature.test.ts checks that the four documents which state
 * that signature agree on it; a sentence is not a guarantee, and this file is
 * where the claim meets the sources.
 *
 * The stakes are the whole security argument. An engine that fetches an
 * input's value or a protocol parameter mid-derivation has put a network call
 * between a person and a signature — one that can be made slow, made to fail,
 * or made to answer wrongly by whoever benefits from the wrong answer. It also
 * costs us the attack examples: "every lying transaction was blocked" is a
 * property of a function, and stops being one the moment the function has
 * somewhere else to look.
 *
 * Two checks, because neither alone is enough. The scan reads every source
 * file and rejects any way in — including a branch no test happens to enter.
 * The trap loads the module with every route out of the process poisoned and
 * proves the code that actually runs takes none of them.
 *
 * It covers I/O and not non-determinism: a clock or a random number is a
 * separate concern, and derivation is handed its validity interval rather than
 * asked to compare it against now.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

/**
 * The runtime dependencies `verifier` is allowed to carry, and the only list
 * a widening has to go through. No test can prove a dependency is pure — this
 * is a judgement, recorded, and CODEOWNERS routes any edit to it for review.
 * A CBOR library is deliberately absent: it arrives with the decode ticket,
 * in the pull request that argues for it.
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

/**
 * Every module specifier a file names — static imports, `export … from`,
 * `import()`, and `require()`. Regex over the text would miss the last two and
 * trip over the word "import" in a comment.
 */
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
    // Guards every assertion below from passing over an empty directory. The
    // package scaffolds with one module; it never has none.
    expect(sources.length).toBeGreaterThan(0)
  })

  it("imports no node builtin", () => {
    // `node:fs`, `node:net`, `node:http` — and the bare spellings, which
    // resolve to the same modules and would slip past a `node:` prefix check.
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
    const reaching = bareImports.filter(
      ({ what }) => builtins.has(what.split("/").slice(0, 2).join("/")) || builtins.has(what)
    )
    expect(reaching).toEqual([])
  })

  it("imports nothing from flow or server", () => {
    // The dependency direction from docs/ARCHITECTURE.md, asserted rather
    // than left to review. `flow` is where the network layer lives.
    const crossing = imports.filter(({ what }) =>
      forbiddenPackages.some((name) => what === name || what.startsWith(`${name}/`))
    )
    expect(crossing).toEqual([])
  })

  it("imports only packages the manifest declares", () => {
    // A phantom dependency works locally, through whatever the workspace
    // happens to have installed, and fails on a consumer's clean install.
    const undeclared = bareImports.filter(
      ({ what }) => !declaredDependencies.some((name) => what === name || what.startsWith(`${name}/`))
    )
    expect(undeclared).toEqual([])
  })

  it("stays inside the package", () => {
    // A relative import that climbs out of `src` reaches code that is neither
    // published nor covered by any of this.
    const escaping = imports
      .filter(({ what }) => what.startsWith("."))
      .filter(({ file, what }) => {
        const target = resolve(join(packageRoot, file), "..", what)
        return !target.startsWith(`${sourceRoot}/`)
      })
    expect(escaping).toEqual([])
  })

  it("names no global that can leave the process", () => {
    // `fetch` needs no import. Neither does `navigator.sendBeacon`, and
    // `process` is the ambient input a pure function should not be reading.
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

/**
 * The runtime half. Every builtin that can touch a disk, a socket or another
 * process is replaced with a recorder, so an import the scan somehow missed —
 * one reached through a dependency, say — still shows up here.
 */
const io = { reached: [] as string[] }

/**
 * A stand-in for one builtin, built from that builtin's own export names —
 * Vitest resolves a mocked module's named exports against the object the
 * factory returns, so a catch-all proxy would throw on the first import rather
 * than record it, and a throw is evidence nobody sees. Every function becomes
 * a recorder that returns rather than fails, so the caller carries on and the
 * whole list of what it touched survives to the assertion. Non-function
 * exports pass through: a constant is not a way out of the process.
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

/**
 * `vi.doMock` rather than `vi.mock`: this file reads the sources above with
 * `node:fs`, and a hoisted mock would take that away from it. `doMock` is not
 * hoisted and applies only to imports that come after it, which is exactly the
 * one dynamic import below.
 */
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

    // Then every export it offers, so a call is what trips the trap rather
    // than an import. Arguments are none — the recorders fire before any
    // function gets far enough to mind.
    for (const value of Object.values(entry)) {
      if (typeof value !== "function") continue
      try {
        ;(value as (...arguments_: unknown[]) => unknown)()
      } catch {
        // Calling with no arguments throws, and that is fine: a recorder logs
        // before it returns, so what the call reached is already on the list
        // by the time anything downstream objects to the arguments.
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
