import { readdirSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * A React Server Components framework treats a module without `"use client"`
 * as server code, and a component using state fails the consumer's build there.
 * Components live in `.tsx`; everything else stays callable from a server.
 */

const sourceRoot = join(import.meta.dirname, "..", "src")

const sources = readdirSync(sourceRoot)
  .filter((name) => [".ts", ".tsx"].includes(extname(name)))
  .map((name) => ({ name, text: readFileSync(join(sourceRoot, name), "utf8") }))

/** Whether the module's directive prologue says `"use client"`. */
function isClientModule(text: string, fileName: string): boolean {
  const tree = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  for (const statement of tree.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false
    if (statement.expression.text === "use client") return true
  }
  return false
}

describe("the client boundary", () => {
  it("marks every component module", () => {
    const unmarked = sources
      .filter(({ name }) => extname(name) === ".tsx")
      .filter(({ name, text }) => !isClientModule(text, name))
      .map(({ name }) => name)
    expect(unmarked).toEqual([])
  })

  it("marks nothing else", () => {
    // A marked module's functions cannot be called on a server, and balancing
    // or wallet discovery run from a server component are both fair uses.
    const marked = sources
      .filter(({ name }) => extname(name) === ".ts")
      .filter(({ name, text }) => isClientModule(text, name))
      .map(({ name }) => name)
    expect(marked).toEqual([])
  })

  it("survives compilation", () => {
    const { name, text } = sources.find(({ name }) => name === "slip-card.tsx")!
    const { outputText } = ts.transpileModule(text, {
      fileName: name,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 }
    })
    expect(isClientModule(outputText, "slip-card.js")).toBe(true)
  })
})
