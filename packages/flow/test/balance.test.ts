import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodePartialIntent, type Intent, type PartialIntent } from "@cardano-slips/core"
import { delegate, tip } from "@cardano-slips/example-slips"
import {
  compare,
  decodeBech32,
  decodeTransaction,
  deriveEffects,
  minimumLovelace,
  type Verdict
} from "@cardano-slips/verifier"
import { Either, Effect } from "effect"
import { describe, expect, it } from "vitest"

import { balanceIntent, type BalanceInputs, type BalancedTransaction } from "../src/balance.js"
import { type BalanceError, balanceRefusals, type BalanceRefusal, slipErrorCodeFor } from "../src/balance-error.js"
import { enterpriseAddress, mainnetAddress } from "./stub-wallet.js"
import { asResolvedInput, mainnetParameters, rewardAccountOf, type UtxoSpec, walletUtxo } from "./wallet-utxos.js"

/**
 * Every transaction here is built by evolution-sdk and read back by the
 * verifier's own decoder: the two halves have to agree on bytes, and a test
 * that only checked our side would not notice when they stop.
 */

const examples = join(import.meta.dirname, "..", "..", "..", "spec", "examples", "partial", "valid")

const specIntent = (file: string): Intent => {
  const decoded = decodePartialIntent(JSON.parse(readFileSync(join(examples, file), "utf8")))
  if (Either.isLeft(decoded)) throw new Error(`${file} is not a partial intent`)
  return decoded.right.intent
}

/** One minute before the spec examples expire, so their own `validUntil` is the live one. */
const beforeExpiry = Date.parse("2026-08-22T19:39:00Z")

const held = (lovelace: bigint, seed = 1): UtxoSpec => ({ bech32: mainnetAddress.bech32, lovelace, seed })

const funded = (lovelace: bigint, seed = 1) => walletUtxo(held(lovelace, seed))

const inputs = (intent: Intent, overrides: Partial<BalanceInputs> = {}): BalanceInputs => ({
  intent,
  network: "mainnet",
  changeAddress: mainnetAddress.bech32,
  utxos: [funded(100_000_000n)],
  parameters: mainnetParameters,
  now: beforeExpiry,
  ...overrides
})

const balance = (intent: Intent, overrides: Partial<BalanceInputs> = {}): Promise<BalancedTransaction> =>
  Effect.runPromise(balanceIntent(inputs(intent, overrides)))

/** Every refusal this suite has reached, so the closed set can be checked at the end. */
const reached = new Set<BalanceRefusal>()

const expectRefusal = async (
  intent: Intent,
  overrides: Partial<BalanceInputs>,
  refusal: BalanceRefusal
): Promise<BalanceError> => {
  const result = await Effect.runPromise(Effect.either(balanceIntent(inputs(intent, overrides))))
  if (Either.isRight(result)) throw new Error("the build was expected to fail and did not")
  expect(result.left.refusal).toBe(refusal)
  reached.add(result.left.refusal)
  return result.left
}

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"))

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex")

/** The body as `verifier` reads it, which is the only reading that decides anything. */
const decoded = (built: BalancedTransaction) => {
  const result = decodeTransaction(fromHex(built.cbor))
  if (Either.isLeft(result)) throw new Error(`the verifier refused our own transaction: ${result.left.message}`)
  return result.right.body
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

/** The address bytes a bech32 string encodes, read with the decoder the verifier ships. */
const addressBytesOf = (bech32: string): Uint8Array => {
  const result = decodeBech32(bech32)
  if (Either.isLeft(result)) throw new Error(`${bech32} is not bech32: ${result.left.detail}`)
  return result.right.bytes
}

/** What this address receives across every output, which is the figure a person is shown. */
const lovelaceTo = (built: BalancedTransaction, bech32: string): bigint => {
  const wanted = addressBytesOf(bech32)
  return decoded(built)
    .outputs.filter((output) => sameBytes(output.address, wanted))
    .reduce((total, output) => total + output.value.coin, 0n)
}

/**
 * The client's own gate, run over the client's own transaction. Everything else
 * here reads the body and agrees with itself; only this says the balancer built
 * something `verifier` will let a person sign. A mismatch here in the field is a
 * Slip nobody can complete, and it would be our bug, not the endpoint's.
 */
const verdictOn = (
  built: BalancedTransaction,
  declared: Intent,
  wallet: ReadonlyArray<UtxoSpec>,
  now: number
): Verdict => {
  const transaction = decodeTransaction(fromHex(built.cbor))
  if (Either.isLeft(transaction))
    throw new Error(`the verifier refused our own transaction: ${transaction.left.message}`)

  const effects = deriveEffects({
    transaction: transaction.right,
    // The change address and the reward account behind it: what this wallet owns.
    userAddresses: [addressBytesOf(mainnetAddress.bech32), rewardAccountOf(mainnetAddress.bech32)],
    resolvedInputs: wallet.map(asResolvedInput),
    protocolParameters: mainnetParameters
  })
  if (Either.isLeft(effects))
    throw new Error(`the verifier could not derive our own transaction: ${effects.left.message}`)

  const verdict = compare({
    effects: effects.right,
    declared,
    changeAddress: mainnetAddress.bech32,
    now: BigInt(now),
    protocolParameters: mainnetParameters
  })
  if (Either.isLeft(verdict))
    throw new Error(`the verifier could not compare our own transaction: ${verdict.left.message}`)
  return verdict.right
}

/** The reasons a block would carry, so a failure here names what disagreed. */
const blockedBy = (
  built: BalancedTransaction,
  declared: Intent,
  wallet: ReadonlyArray<UtxoSpec>,
  now = beforeExpiry
) => {
  const verdict = verdictOn(built, declared, wallet, now)
  return verdict._tag === "match" ? [] : verdict.reasons.map((reason) => reason.code)
}

const postedIntent = async (response: Response): Promise<Intent> => {
  const payload = (await response.json()) as unknown
  const decodedPayload = decodePartialIntent(payload)
  if (Either.isLeft(decodedPayload)) throw new Error("the fixture did not answer with a partial intent")
  return (decodedPayload.right as PartialIntent).intent
}

const postRequest = (url: string): Request =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changeAddress: mainnetAddress.bech32, network: "mainnet" })
  })

describe("a payment", () => {
  it("pays the declared address exactly what the intent declared", async () => {
    const built = await balance(specIntent("payment.json"))
    const body = decoded(built)

    expect(body.outputs.length).toBe(2)
    expect(built.fee).toBeGreaterThan(0n)
    expect(
      lovelaceTo(
        built,
        "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
      )
    ).toBe(12_000_000n)
  })

  it("returns the remainder to the change address, and spends nothing else", async () => {
    const built = await balance(specIntent("payment.json"))

    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(100_000_000n - 12_000_000n - built.fee)
  })

  it("pays two addresses from one intent", async () => {
    const built = await balance(specIntent("split-contribution.json"))

    expect(
      lovelaceTo(
        built,
        "addr1qxcd9f33uzmeftka0df9mqqngnv7n5pysjpz4x4rkc30vgje9ckxtcvv6fygn4lutdqf56khahq80sujcrn0rhn3mg3sj0pnxm"
      )
    ).toBe(25_000_000n)
    expect(
      lovelaceTo(
        built,
        "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
      )
    ).toBe(5_000_000n)
  })
})

describe("the tip fixture", () => {
  it("becomes a transaction paying the author the amount its URL carried", async () => {
    const intent = await postedIntent(await tip.POST(postRequest("https://linktap.example/api/slips/tip?amount=25")))
    const built = await balance(intent, { now: Date.now() })

    expect(
      lovelaceTo(
        built,
        "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
      )
    ).toBe(25_000_000n)
  })
})

describe("the delegate fixture", () => {
  it("carries one delegation certificate and pays nobody", async () => {
    const intent = await postedIntent(await delegate.POST(postRequest("https://linktap.example/api/slips/delegate")))
    const built = await balance(intent, { now: Date.now() })
    const body = decoded(built)

    expect(body.certificates?.length).toBe(1)
    expect(body.certificates?.[0]?._tag).toBe("StakeDelegation")
    // Only the change output: a delegation moves nothing.
    expect(body.outputs.length).toBe(1)
    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(100_000_000n - built.fee)
  })
})

describe("declared lovelace is a floor", () => {
  const holding = {
    policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
    assetName: "5553444d",
    quantity: 50_000_000n
  }

  const tokenPayment = (): Promise<BalancedTransaction> =>
    balance(specIntent("token-payment.json"), {
      utxos: [walletUtxo({ bech32: mainnetAddress.bech32, lovelace: 100_000_000n, assets: [holding] })]
    })

  const shop = "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"

  it("raises an output that cannot pay for its own bytes to exactly the ledger's minimum", async () => {
    const built = await tokenPayment()
    const paid = decoded(built).outputs.find((output) => sameBytes(output.address, addressBytesOf(shop)))

    // Declared "0", so every lovelace here is the client's own adjustment — and
    // the figure is the gate's own, computed from the bytes the output occupies.
    expect(paid?.value.coin).toBe(minimumLovelace(paid?.size ?? 0, mainnetParameters))
  })

  it("sends the declared quantity of the asset itself", async () => {
    const sent = decoded(await tokenPayment())
      .outputs.filter((output) => sameBytes(output.address, addressBytesOf(shop)))
      .flatMap((output) => output.value.assets)
      .filter((policy) => toHex(policy.policyId) === holding.policyId)
      .flatMap((policy) => policy.assets)

    expect(sent.map((asset) => asset.quantity)).toEqual([12_000_000n])
  })
})

describe("a certificate the ledger charges for", () => {
  const registration: Intent = {
    certificates: [{ type: "stakeRegistration" }],
    validUntil: "2026-08-22T19:40:00Z"
  }

  const deregistration: Intent = {
    certificates: [{ type: "stakeDeregistration" }],
    validUntil: "2026-08-22T19:40:00Z"
  }

  it("takes the stake deposit out of the wallet", async () => {
    const built = await balance(registration)

    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(100_000_000n - built.fee - mainnetParameters.stakeDeposit)
  })

  it("states the deposit the protocol parameter fixes, so the gate can hold it to one", async () => {
    const built = await balance(registration)
    const certificate = decoded(built).certificates?.[0]

    expect(certificate?._tag).toBe("Registration")
    expect(certificate?._tag === "Registration" ? certificate.deposit : 0n).toBe(mainnetParameters.stakeDeposit)
  })

  it("returns the deposit to the wallet when the credential is retired", async () => {
    const built = await balance(deregistration)

    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(100_000_000n - built.fee + mainnetParameters.stakeDeposit)
  })
})

describe("a vote delegation", () => {
  const voteTo = (drep: string): Intent => ({
    certificates: [{ type: "voteDelegation", drep }],
    validUntil: "2026-08-22T19:40:00Z"
  })

  it("delegates to a DRep named in bech32", async () => {
    const built = await balance(specIntent("vote-delegation.json"))
    const certificate = decoded(built).certificates?.[0]

    expect(certificate?._tag).toBe("VoteDelegation")
  })

  it("carries the two predefined votes", async () => {
    for (const vote of ["abstain", "noConfidence"] as const) {
      const certificate = decoded(await balance(voteTo(vote))).certificates?.[0]

      expect(certificate?._tag).toBe("VoteDelegation")
    }
  })
})

describe("a rewards withdrawal", () => {
  it("withdraws the whole balance it was handed, and no other figure", async () => {
    const built = await balance(specIntent("rewards-withdrawal.json"), { rewardBalance: 7_250_000n })
    const body = decoded(built)

    expect(body.withdrawals?.length).toBe(1)
    expect(body.withdrawals?.[0]?.amount).toBe(7_250_000n)
    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(100_000_000n + 7_250_000n - 5_000_000n - built.fee)
  })

  it("will not guess the balance when nobody supplies one", async () => {
    const error = await expectRefusal(specIntent("rewards-withdrawal.json"), {}, "RewardBalanceUnknown")

    expect(error.code).toBe("CANNOT_BALANCE")
  })
})

describe("the validity interval", () => {
  it("ends no later than the intent said it may", async () => {
    const built = await balance(specIntent("payment.json"))
    const declared = BigInt(Date.parse("2026-08-22T19:40:00Z"))
    const { slots } = mainnetParameters
    const endsAt = slots.time + (built.ttl - slots.slot) * slots.slotLength

    expect(endsAt).toBeLessThanOrEqual(declared)
  })

  it("refuses an intent that expired while the person was reading it", async () => {
    const error = await expectRefusal(
      specIntent("payment.json"),
      { now: Date.parse("2026-08-22T19:41:00Z") },
      "IntentExpired"
    )

    expect(error.code).toBe("INTENT_EXPIRED")
  })
})

describe("coin selection", () => {
  // Every other case here funds the wallet with one unspent output, which
  // selects nothing. A person's wallet is a scattering of them.
  const scattered = [held(4_000_000n, 1), held(4_000_000n, 2), held(4_000_000n, 3), held(4_000_000n, 4)]

  it("spends as many unspent outputs as the payment needs, and no fewer", async () => {
    const built = await balance(specIntent("payment.json"), { utxos: scattered.map(walletUtxo) })

    // Three cover neither the 12 ADA nor the fee and the change minimum after it.
    expect(decoded(built).inputs.length).toBe(4)
    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(16_000_000n - 12_000_000n - built.fee)
  })

  it("leaves the unspent outputs it did not need alone", async () => {
    const wallet = [...scattered, held(100_000_000n, 5)]
    const built = await balance(specIntent("payment.json"), { utxos: wallet.map(walletUtxo) })
    const spent = decoded(built).inputs

    expect(spent.length).toBeLessThan(wallet.length)
    // What the body spends is what the change output accounts for, however many
    // inputs that took — the arithmetic has to hold across all of them.
    const swept = wallet
      .filter((utxo) => spent.some((input) => toHex(input.transactionId) === String(utxo.seed).padStart(64, "a")))
      .reduce((total, utxo) => total + utxo.lovelace, 0n)
    expect(lovelaceTo(built, mainnetAddress.bech32)).toBe(swept - 12_000_000n - built.fee)
  })

  it("pays from many small outputs what it would have paid from one large one", async () => {
    const built = await balance(specIntent("payment.json"), { utxos: scattered.map(walletUtxo) })

    expect(
      lovelaceTo(
        built,
        "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us"
      )
    ).toBe(12_000_000n)
  })
})

describe("what the client's own gate says about what the client built", () => {
  const oneOutput = [held(100_000_000n)]

  it("signs the payment", async () => {
    const intent = specIntent("payment.json")

    expect(blockedBy(await balance(intent), intent, oneOutput)).toEqual([])
  })

  it("signs a payment that took several unspent outputs to cover", async () => {
    const wallet = [held(4_000_000n, 1), held(4_000_000n, 2), held(4_000_000n, 3), held(4_000_000n, 4)]
    const intent = specIntent("payment.json")
    const built = await balance(intent, { utxos: wallet.map(walletUtxo) })

    expect(blockedBy(built, intent, wallet)).toEqual([])
  })

  it("signs the split contribution, which pays two addresses", async () => {
    const intent = specIntent("split-contribution.json")

    expect(blockedBy(await balance(intent), intent, oneOutput)).toEqual([])
  })

  it("signs the token payment, whose declared lovelace was raised to the minimum", async () => {
    const wallet = [
      {
        bech32: mainnetAddress.bech32,
        lovelace: 100_000_000n,
        assets: [
          {
            policyId: "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
            assetName: "5553444d",
            quantity: 50_000_000n
          }
        ]
      }
    ]
    const intent = specIntent("token-payment.json")
    const built = await balance(intent, { utxos: wallet.map(walletUtxo) })

    expect(blockedBy(built, intent, wallet)).toEqual([])
  })

  it("signs the stake registration, deposit and all", async () => {
    const intent: Intent = { certificates: [{ type: "stakeRegistration" }], validUntil: "2026-08-22T19:40:00Z" }

    expect(blockedBy(await balance(intent), intent, oneOutput)).toEqual([])
  })

  it("signs the vote delegation", async () => {
    const intent = specIntent("vote-delegation.json")

    expect(blockedBy(await balance(intent), intent, oneOutput)).toEqual([])
  })

  it("signs the rewards withdrawal, against the wallet's own reward account", async () => {
    const intent = specIntent("rewards-withdrawal.json")
    const built = await balance(intent, { rewardBalance: 7_250_000n })

    expect(blockedBy(built, intent, oneOutput)).toEqual([])
  })

  it("signs the delegate fixture end to end", async () => {
    const intent = await postedIntent(await delegate.POST(postRequest("https://linktap.example/api/slips/delegate")))
    const now = Date.now()
    const built = await balance(intent, { now })

    expect(blockedBy(built, intent, oneOutput, now)).toEqual([])
  })

  it("signs the tip fixture end to end", async () => {
    const intent = await postedIntent(await tip.POST(postRequest("https://linktap.example/api/slips/tip?amount=25")))
    const now = Date.now()
    const built = await balance(intent, { now })

    expect(blockedBy(built, intent, oneOutput, now)).toEqual([])
  })
})

describe("what cannot be built", () => {
  it("refuses when the wallet cannot cover the payment and the fee", async () => {
    const error = await expectRefusal(specIntent("payment.json"), { utxos: [funded(5_000_000n)] }, "InsufficientFunds")

    expect(error.code).toBe("INSUFFICIENT_FUNDS")
    expect(String(error.cause)).toContain("Coin selection failed")
  })

  it("refuses when what is left over is too small to become change", async () => {
    // Enough for the payment and the fee, not enough for a change output to
    // reach its own minimum — paying it as fee would be lovelace nothing declared.
    const error = await expectRefusal(specIntent("payment.json"), { utxos: [funded(12_500_000n)] }, "InsufficientFunds")

    // The two shortfalls are separate sites in evolution-sdk, told apart by the
    // words it uses; pinning both is what keeps that reading honest.
    expect(String(error.cause)).toContain("Insufficient funds to cover")
  })

  it("refuses an address on another network", async () => {
    const error = await expectRefusal(specIntent("payment.json"), { network: "preprod" }, "ForeignAddress")

    expect(error.code).toBe("MALFORMED_RESPONSE")
  })

  it("refuses a certificate when the wallet's address carries no stake credential", async () => {
    const error = await expectRefusal(
      { certificates: [{ type: "stakeRegistration" }], validUntil: "2026-08-22T19:40:00Z" },
      {
        changeAddress: enterpriseAddress.bech32,
        utxos: [walletUtxo({ bech32: enterpriseAddress.bech32, lovelace: 100_000_000n })]
      },
      "NoStakeCredential"
    )

    expect(error.code).toBe("CANNOT_BALANCE")
  })

  it("refuses a change address it cannot read, rather than throwing past the error channel", async () => {
    // The connect step hands over an address it decoded itself, so this is not
    // reachable through the flow — but the signature promises a refusal, and a
    // defect here would reach a person as a stack trace instead of words.
    const error = await expectRefusal(
      specIntent("payment.json"),
      { changeAddress: "addr1notanaddressatall" },
      "UnreadableChangeAddress"
    )

    expect(error.code).toBe("CANNOT_BALANCE")
    expect(error.message).not.toContain("ParseError")
  })

  it("refuses an intent no transaction can carry", async () => {
    const tooMany: Intent = {
      outputs: Array.from({ length: 16 }, () => ({
        address:
          "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us",
        lovelace: "2000000"
      })),
      validUntil: "2026-08-22T19:40:00Z"
    }
    const error = await expectRefusal(
      tooMany,
      { parameters: { ...mainnetParameters, maxTxSize: 200 } },
      "CannotBalance"
    )

    expect(error.code).toBe("CANNOT_BALANCE")
  })
})

describe("an intent that acts on no stake credential", () => {
  it("builds for a wallet that has none, because an empty certificate list acts on nothing", async () => {
    const built = await balance(
      { ...specIntent("payment.json"), certificates: [] },
      {
        changeAddress: enterpriseAddress.bech32,
        utxos: [walletUtxo({ bech32: enterpriseAddress.bech32, lovelace: 100_000_000n })]
      }
    )

    expect(decoded(built).certificates ?? []).toEqual([])
  })
})

describe("the refusals", () => {
  it("are every one the type allows, each reached by a case above", () => {
    expect([...reached].sort()).toEqual(Object.keys(balanceRefusals).sort())
  })

  it("each carry a spec error code", () => {
    for (const refusal of Object.keys(balanceRefusals) as Array<BalanceRefusal>) {
      expect(slipErrorCodeFor(refusal)).toBeTruthy()
    }
  })
})
