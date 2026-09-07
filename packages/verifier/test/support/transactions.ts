/**
 * Transactions built as data rather than decoded from bytes. The arithmetic
 * under test is the derivation, so a body assembled here is an input to it,
 * not a stand-in for the decoder.
 */
import type { DecodedTransaction, TransactionBody } from "../../src/decode.js"

const empty: TransactionBody = {
  inputs: [],
  outputs: [],
  fee: 0n,
  validityIntervalEnd: null,
  certificates: [],
  withdrawals: [],
  auxiliaryDataHash: null,
  validityIntervalStart: null,
  mint: [],
  scriptDataHash: null,
  collateralInputs: [],
  requiredSigners: [],
  networkId: null,
  collateralReturn: null,
  totalCollateral: null,
  referenceInputs: [],
  votingProcedures: [],
  proposalProcedures: [],
  currentTreasuryValue: null,
  donation: null
}

export const body = (fields: Partial<TransactionBody> = {}): TransactionBody => ({ ...empty, ...fields })

/**
 * The byte range is not read by the derivation; the commit is the decoder's
 * business. `size` is, though — it is what the minimum fee is charged on — so
 * a test that compares a fee has to say how large the transaction was.
 */
export const transaction = (fields: Partial<TransactionBody> = {}, isValid = true, size = 0): DecodedTransaction => ({
  body: body(fields),
  size,
  bodyBytes: new Uint8Array(),
  bodyRange: { start: 0, end: 0 },
  isValid
})
