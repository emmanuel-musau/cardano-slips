/**
 * The public entry point of `@cardano-slips/core`.
 *
 * Everything a consumer may import is re-exported from here, and the package
 * `exports` map exposes this module and nothing else — a deep import into
 * `dist/` is not a supported surface, so moving a file is never a breaking
 * change. The contract lands one issue at a time — the payload types, URL
 * resolution, `slips.json` mapping, and the error codes
 * (docs/ARCHITECTURE.md).
 */
export {}
