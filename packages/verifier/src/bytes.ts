/** Hex, because a Uint8Array cannot be a map key and a byte string has to be one. */

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
