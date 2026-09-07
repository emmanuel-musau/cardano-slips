/**
 * The two bounds the comparison holds a transaction to, computed from the
 * protocol parameters rather than handed in. The spec admits no tolerance
 * anywhere, so each of these has to be an exact figure with a stated cause —
 * a caller allowed to supply them could supply them generously, and the fee
 * ceiling is the one place an undeclared payment could otherwise hide.
 */
import type { ProtocolParameters } from "./parameters.js"

/** The lovelace the protocol parameters require for a transaction of this many bytes. */
export const minimumFee = (size: number, { minFeeCoefficient, minFeeConstant }: ProtocolParameters): bigint =>
  minFeeCoefficient * BigInt(size) + minFeeConstant

/**
 * The ledger's own overhead for an unspent output, in the same units as the
 * output's own bytes. Fixed by the ledger rather than by a protocol parameter,
 * which is why it is a constant here.
 */
const UTXO_OVERHEAD = 160n

/**
 * The minimum ADA an output must hold, from the bytes it occupies as encoded.
 * Taking the size from the encoding rather than from the fields means the
 * figure is the one the ledger will charge, not a reconstruction of it.
 */
export const minimumLovelace = (size: number, { coinsPerUtxoByte }: ProtocolParameters): bigint =>
  coinsPerUtxoByte * (UTXO_OVERHEAD + BigInt(size))

/** Bytes a CBOR head occupies for an argument of this size, the argument included. */
const headWidth = (argument: bigint): number =>
  argument < 24n ? 1 : argument < 0x100n ? 2 : argument < 0x1_0000n ? 3 : argument < 0x1_0000_0000n ? 5 : 9

/**
 * `[address, coin]` — the smallest encoding an output can take, and the one the
 * quoted mainnet minimum of 0.969750 ADA is computed from.
 */
const changeOutputSize = (address: Uint8Array, coin: bigint): number =>
  1 + headWidth(BigInt(address.length)) + address.length + headWidth(coin)

/**
 * The minimum ADA an output returning change to this address would require —
 * the second term of the fee ceiling, and the only reason a balancer
 * legitimately pays more fee than the transaction costs.
 *
 * Iterated because the answer is part of what it is measured from: a larger
 * amount can take a wider CBOR integer, which makes the output longer, which
 * raises the minimum again. Two rounds settle it and the third proves it.
 */
export const minimumChangeLovelace = (address: Uint8Array, parameters: ProtocolParameters): bigint => {
  let coin = 0n
  for (let round = 0; round < 4; round++) {
    const next = minimumLovelace(changeOutputSize(address, coin), parameters)
    if (next === coin) return coin
    coin = next
  }
  return coin
}
