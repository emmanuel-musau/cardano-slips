import { describe, expect, it } from "vitest"

describe("the public entry point", () => {
  it("loads", async () => {
    const entry = await import("../src/index.js")
    expect(entry).toBeTypeOf("object")
  })
})
