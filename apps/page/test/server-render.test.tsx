// @vitest-environment node

import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

/**
 * Next prerenders the page on a server before any browser sees it, so anything
 * the page imports that reads `window` while loading fails the build there.
 */

describe("the page on a server", () => {
  it("has no browser globals to read", () => {
    expect(typeof globalThis.window).toBe("undefined")
  })

  it("renders to HTML", async () => {
    const { default: Page } = await import("../src/app/page.js")
    expect(renderToString(<Page />)).toContain("Loading this Slip")
  })
})
