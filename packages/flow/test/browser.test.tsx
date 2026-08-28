import { readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { extname, join, relative } from "node:path"
import { render, screen } from "@testing-library/react"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * The browser target, proved rather than configured: the JSX transform, React's
 * types, and the happy-dom environment agree or silently do not. Exercised on a
 * component that does nothing, so there is nothing else to blame.
 */

const packageRoot = join(import.meta.dirname, "..")
const sourceRoot = join(packageRoot, "src")

describe("the test environment", () => {
  it("has a document", () => {
    expect(typeof document).toBe("object")
    expect(document.body).toBeDefined()
  })

  it("renders a component through the automatic JSX runtime", () => {
    // No `import React` in this file: that is `jsx: "react-jsx"` working.
    const Slip = ({ label }: { label: string }): React.JSX.Element => <button type="button">{label}</button>

    render(<Slip label="Pay 12.00 USDM" />)
    expect(screen.getByRole("button", { name: "Pay 12.00 USDM" })).toBeDefined()
  })
})

/** Every `.ts` and `.tsx` file under `src`. */
function sourceFiles(directory: string = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

describe("what ships to a browser", () => {
  it("imports no Node builtin", () => {
    // A `node:fs` import typechecks under NodeNext with or without the globals,
    // and reaches a bundler as an unresolvable module or an unwanted polyfill.
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

    const reached = sourceFiles().flatMap((path) => {
      const tree = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true)
      const found: Array<{ file: string; specifier: string }> = []
      const step = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier !== undefined &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          builtins.has(node.moduleSpecifier.text)
        ) {
          found.push({ file: relative(packageRoot, path), specifier: node.moduleSpecifier.text })
        }
        ts.forEachChild(node, step)
      }
      step(tree)
      return found
    })

    expect(reached).toEqual([])
  })
})
