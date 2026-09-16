/**
 * Witness sets in the form a wallet returns them: CBOR hex, built with
 * evolution-sdk's own codecs so a fixture cannot encode something no wallet
 * would send. Nothing here signs anything — assembly never checks a signature,
 * and a fixture that pretended to would be proving something else.
 */
import {
  Ed25519Signature,
  KeyHash,
  NativeScripts,
  Transaction,
  TransactionWitnessSet,
  VKey
} from "@evolution-sdk/evolution"

/** One hex character, repeated: distinct per seed, so an appended witness is identifiable. */
export const vkeyWitness = (seed: string): TransactionWitnessSet.VKeyWitness =>
  new TransactionWitnessSet.VKeyWitness({
    vkey: VKey.fromHex(seed.repeat(64)),
    signature: Ed25519Signature.fromHex(seed.repeat(128))
  })

export const witnessSet = (...seeds: ReadonlyArray<string>): string =>
  TransactionWitnessSet.toCBORHex(TransactionWitnessSet.fromVKeyWitnesses(seeds.map(vkeyWitness)))

/** A witness set with nothing in it: what a wallet returns when it signed nothing. */
export const emptyWitnessSet = (): string => TransactionWitnessSet.toCBORHex(TransactionWitnessSet.empty())

/**
 * A signature alongside script material. Version 1 builds no transaction that
 * spends from a script, so this is a wallet putting into the set something the
 * body was never judged with.
 */
export const witnessSetWithScript = (seed: string): string =>
  TransactionWitnessSet.toCBORHex(
    new TransactionWitnessSet.TransactionWitnessSet({
      vkeyWitnesses: [vkeyWitness(seed)],
      nativeScripts: [NativeScripts.makeScriptPubKey(KeyHash.toBytes(KeyHash.fromHex("b".repeat(56))))]
    })
  )

/** The vkey of every witness a transaction carries, in the order its set carries them. */
export const vkeysIn = (transaction: string): ReadonlyArray<string> =>
  (Transaction.fromCBORHex(transaction).witnessSet.vkeyWitnesses ?? []).map((witness) => VKey.toHex(witness.vkey))
