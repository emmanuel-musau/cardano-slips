/**
 * The GET examples from `spec/examples/get/valid`, decoded rather than typed by
 * hand. A fixture the spec does not vouch for is a fixture that can drift away
 * from the thing it is standing in for.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeSlip, type Slip } from "@cardano-slips/core"
import { Either } from "effect"

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "get", "valid")

export const slipExample = (name: string): Slip => {
  const decoded = decodeSlip(JSON.parse(readFileSync(join(examples, `${name}.json`), "utf8")))
  if (Either.isLeft(decoded)) throw new Error(`${name}.json is not a Slip: ${String(decoded.left)}`)
  return decoded.right
}

export const discoveryUrl = "https://linktap.example/api/slips/pay/corner-store"
