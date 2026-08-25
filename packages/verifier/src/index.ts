/**
 * The public entry point of `@cardano-slips/verifier`. The `exports` map
 * exposes this module and nothing else, so moving a file is never a breaking
 * change.
 *
 * This package is a pure function of (tx CBOR, declared metadata, user
 * addresses, resolved inputs, protocol parameters) — all five arguments, no
 * socket, no file, no service. `test/no-io.test.ts` fails if that stops holding.
 */
export {}
