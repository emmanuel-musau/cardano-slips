# The fixtures

Fifty-three mainnet transactions, each one a file, plus CIP-0186's two published
CBOR vectors under `cip-0186/`. They are what `verifier` is held to: the decoder
reads the bytes, the derivation reads what the transaction does, and both
answers are checked against the chain's own reading of the same transaction,
recorded when the fixture was collected.

Nothing here touches the network at test time. The readings are frozen in the
file, so the suite is offline and a fixture cannot change meaning because an
explorer changed. See [ADR-0012](../../../../docs/DECISIONS/0012-decode-test-oracle.md)
for why the chain's reading is the oracle rather than a second CBOR library.

## Adding one

```
pnpm build
node scripts/collect-fixture.mjs <name> <transaction id>
```

The script pulls the bytes and the reading from Koios, writes
`test/fixtures/<name>.json`, and refuses to write a file the suite would
reject — it checks the commit, the fee, what the user spends and receives,
deposits less refunds, and that no lovelace is left unaccounted for. The name is
what the transaction is here for, not what it is: `withdrawal-with-assets`, not
`tx-0fb5e8f7`.

A fixture is worth adding when it is the first to carry a shape, or the first to
carry a combination. A fifty-fourth ordinary payment is not.

## What a file holds

| Field           | What it is                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | The file's own name, and what the tests report a failure under.                                                                                                                                          |
| `transactionId` | The chain's id. BLAKE2b-256 over the extracted body must equal it, which is the one check needing no oracle at all.                                                                                      |
| `exercises`     | What this fixture claims to cover, recomputed from the decoded body on every run. A fixture cannot quietly stop covering something.                                                                      |
| `chain`         | What Koios said the transaction does: the fee, the totals, the certificates by type and what each names, the withdrawals, the mint, the validity interval, deposits less refunds, the treasury donation. |
| `user`          | Whoever holds the inputs, which is who signs in Mode A: their addresses, what they spend, what they receive, the ADA delta, and the same per asset.                                                      |
| `resolved`      | The output each input points at. A body carries only references, and the derivation refuses rather than guessing at a value nobody supplied.                                                             |
| `cbor`          | The transaction as it was submitted, witnesses and all.                                                                                                                                                  |

`user.ada` is `spent - received`, positive when lovelace leaves — the direction
the spec states. Asset quantities are raw on-chain counts; a token's decimals
are a display concern and appear nowhere in this directory.

## What the chain and this package disagree about

`db-sync` records a combined registration-and-delegation as its parts, so one
body certificate can produce three rows in `chain.certificates`, all carrying
the position of the certificate that produced them. The tests group the rows by
position rather than pairing them one to one — see
`registration-delegations-and-assets`.

It also collapses shapes this package keeps apart: a legacy stake registration
and its Conway spelling are both `stake_registration`, and a pool
re-registration is a `pool_update`. `test/derive-actions.test.ts` maps each of our
kinds to the words the chain may use for it.

## Shapes with no real bytes yet

These parts of the Conway CDDL did not appear in the transactions collected, so
`test/decode-shapes.test.ts` builds them from the written rules instead and says
so in its own header. Real bytes for any of them are welcome:

- the committee certificates, `AuthorizeCommitteeHot` and `ResignCommitteeCold`
- three of the four combined certificates: `StakeVoteDelegation`,
  `StakeRegistrationDelegation` and `VoteRegistrationDelegation`
- a motion of no confidence
- a treasury donation, and a body stating the current treasury value
