/**
 * The public entry point of `@cardano-slips/verifier`.
 *
 * Everything a consumer may import is re-exported from here, and the package
 * `exports` map exposes this module and nothing else — a deep import into
 * `dist/` is not a supported surface, so moving a file is never a breaking
 * change. The engine lands one issue at a time: CBOR decode, derivation,
 * deposits, and the comparison (docs/ARCHITECTURE.md).
 *
 * Whatever arrives here, one property does not change. This package is a pure
 * function of (tx CBOR, declared metadata, user addresses, resolved inputs,
 * protocol parameters). All five are arguments. It opens no socket, reads no
 * file, and asks no service anything — `test/no-io.test.ts` fails if that
 * stops being true, because the code path that runs before a real signature is
 * not one to take on faith.
 */
export {}
