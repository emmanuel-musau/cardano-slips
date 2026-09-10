/** Hex in, hex out, and the byte surgery the refusal tests need. */
import { toHex } from "../../src/bytes.js"

export { toHex }

export const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex: ${hex.length} characters`)
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

/**
 * Rewrites one run of hex inside a transaction, and fails loudly if the run is
 * not there exactly once. A mutation test that silently changed nothing would
 * pass for the wrong reason.
 */
export const rewriteOnce = (bytes: Uint8Array, find: string, replaceWith: string): Uint8Array => {
  const hex = toHex(bytes)
  const first = hex.indexOf(find)
  if (first === -1) throw new Error(`nothing to rewrite: ${find} does not appear`)
  if (hex.indexOf(find, first + 1) !== -1) throw new Error(`ambiguous rewrite: ${find} appears more than once`)
  return fromHex(hex.slice(0, first) + replaceWith + hex.slice(first + find.length))
}
