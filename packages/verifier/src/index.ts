/**
 * The public entry point of `@cardano-slips/verifier`, and a pure function of
 * its five arguments — no socket, no file, no service. `test/no-io.test.ts`
 * fails if that stops holding.
 */
export type { CborEntry, CborValue, ReadOptions, Span } from "./cbor.js"
export type { DecodeRefusal } from "./decode-error.js"
export { decodeRefusals } from "./decode-error.js"
export { TransactionDecodeError } from "./decode-error.js"
export * from "./decode.js"
export type { DerivationRefusal } from "./derive-error.js"
export { DerivationError, derivationRefusals } from "./derive-error.js"
export * from "./derive.js"
export type { Deposit, DepositBasis, DepositKind, Deposits } from "./deposits.js"
export { readDeposits, totalOf } from "./deposits.js"
export type { ProtocolParameters } from "./parameters.js"
