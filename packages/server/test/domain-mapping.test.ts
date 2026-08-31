import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SlipsJson } from "@cardano-slips/core"
import { describe, expect, it } from "vitest"

import { defineDomainMapping } from "../src/index.js"

/**
 * The mapping is static, so every defect in it is a defect at construction.
 * These run the spec's whole `slips-json` corpus through that one boundary.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "slips-json")

const example = (path: string): SlipsJson => JSON.parse(readFileSync(join(examples, path), "utf8")) as SlipsJson

const namesIn = (path: string): ReadonlyArray<string> =>
  readdirSync(join(examples, path)).filter((n) => n.endsWith(".json"))

const single = example("valid/single-wildcard.json")

describe("a mapping the spec allows", () => {
  for (const name of namesIn("valid")) {
    it(`serves ${name} unchanged`, async () => {
      const file = example(`valid/${name}`)
      const response = defineDomainMapping(file).GET()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(file)
    })
  }

  it("sets the headers a client on another origin cannot work without", () => {
    const headers = defineDomainMapping(single).GET().headers

    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  it("never asks for credentials", () => {
    expect(defineDomainMapping(single).GET().headers.get("Access-Control-Allow-Credentials")).toBeNull()
  })

  it("caches for the interval the spec's own example carries", () => {
    expect(defineDomainMapping(single).GET().headers.get("Cache-Control")).toBe("public, max-age=300")
  })

  it("takes a publisher's own interval", () => {
    const response = defineDomainMapping(single, { maxAge: 60 }).GET()
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60")
  })

  it("serves the same bytes every time, since nothing about it varies by requester", async () => {
    const endpoint = defineDomainMapping(single)
    expect(await endpoint.GET().text()).toBe(await endpoint.GET().text())
  })
})

describe("a mapping the spec rejects", () => {
  for (const bucket of ["schema", "rule"] as const) {
    for (const name of namesIn(`invalid/${bucket}`)) {
      it(`refuses ${bucket}/${name} at construction`, () => {
        expect(() => defineDomainMapping(example(`invalid/${bucket}/${name}`))).toThrow(/slips\.json/)
      })
    }
  }

  it("refuses an interval that is not a whole number of seconds", () => {
    expect(() => defineDomainMapping(single, { maxAge: 1.5 })).toThrow(/whole number/)
  })

  it("refuses a negative interval", () => {
    expect(() => defineDomainMapping(single, { maxAge: -1 })).toThrow(/negative/)
  })
})
