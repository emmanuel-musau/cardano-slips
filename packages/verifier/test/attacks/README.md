# The attack examples

Transactions whose declared metadata lies about what they do. The verifier has
to block every one of them before a signature is asked for, and this directory
is where anyone can check that it does.

**[REPORT.md](REPORT.md)** is the result: every case, what it lies about, the
verdict, and the reasons given. The test run writes it, and CI fails when the
committed copy differs from what the run produces, so it always describes the
code beside it.

A blocked case shows that this transaction is blocked, nothing more. The
examples cover the lies listed here, not every lie an endpoint could tell.
Anything that gets through is a bug, and becomes a case here.

## Running them

From the repository root:

```sh
pnpm install
pnpm test:attacks
```

That is the `attack-examples` check CI runs on every pull request. It counts
every case in one run, fails on a single lying transaction signed or a single
honest one refused, and writes
`packages/verifier/build/reports/attack-examples.json`, which CI keeps as a
build artifact.

To see each case blocked for the reasons it states, from `packages/verifier`:

```sh
pnpm vitest run test/attacks
```

## How a case is built

Each case is a real transaction. The body is encoded as CBOR, then decoded by
the verifier's own decoder and run through its own derivation, so a block here
is a block on the same path a real signature takes. Nothing in that path is
mocked.

Every file has one `honest` transaction that signs, and every case in the file
is one edit away from it. That is what makes each block point at the lie: the
honest transaction shows the gate does not just block everything.

A case states three things beside the transaction:

| Field     | What it is                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `name`    | What the transaction does wrong, in kebab-case. Unique across all three files.                       |
| `lie`     | What the person would believe against what the body does, in the words they would use.              |
| `blocked` | Every reason the comparison must give, in the order it gives them. The test checks the exact list. The report's Reasons column lists each code once, sorted. |

`attacks.test.ts` runs every group and checks that each case is blocked for
exactly its stated reasons, that its declared intent is one the schema accepts (a declaration the
schema refuses proves nothing about the comparison), and that it balances, so
the ledger would take it. `test/regression.test.ts` then counts all of them
together and writes the report.

## The three groups

### What it pays, and who it pays — `value-and-recipient.ts`

The case the whole comparison exists for: the card says tip 5 ADA and the
transaction sends 500 to an address the person has never seen. The cases cover
a wrong amount in either direction, a redirected recipient, extra outputs
hidden beside or behind a declared one, one declared payment split in two, the
wrong asset, a lookalike token with the same name under another policy, and
a display amount written where base units belong, and the reverse, which
pays a million times or a millionth of what the page said.

### What it stakes, and what it drains — `certificates-and-withdrawals.ts`

A delegation link shows almost nothing but a certificate, and a person cannot
tell two pool IDs apart by reading them. So the certificates a body carries and
the rewards it withdraws are held to the intent the same way an output is: the
wrong pool or DRep, a deregistration nobody declared, a misstated deposit,
certificates in an order that changes what they do, a certificate acting on a
stake credential the wallet never reported, and withdrawals that were
undeclared, never made, or taken from someone else's account.

### What it creates, and how long it stays submittable — `mint-and-validity.ts`

Quieter than a redirected payment and no less real. A token minted or burned
that the person was never shown, a lookalike minted and paid in place of the
asset declared, and a mint sent to a stranger. Then the validity interval: no
expiry at all, an expiry past the declared deadline, and a window that opens
later than the person expects to use it.

### The spec's table of verdicts

`spec/examples/effects/verdicts.json` is the table of verdicts the CIP
publishes. Those cases state effects directly rather than encode bytes, so
they prove each rule without proving the decode path. The report counts them
in their own rows.

## Adding a case

**If you found a transaction that gets through, do not open a public pull
request.** That is a live way to rob people. Report it privately as
[SECURITY.md](../../../../SECURITY.md) describes. It becomes a case here once
the fix ships. A failing test sent with the report is the most useful thing you
can include.

A case the verifier already blocks, but that the examples do not yet show, is
welcome as a normal pull request:

1. Pick the file whose group the lie belongs to. If it fits none of them, say
   so in an issue first, because a new group also needs its own `honest`
   transaction, an entry in `test/support/attack-groups.ts`, and its name in
   `test/regression.test.ts`.
2. Add the case to that file's `attacks` list, one edit away from `honest`.
   Write `lie` as the person reading the card would put it, and list every
   reason in `blocked`.
3. Run `pnpm vitest run test/attacks` from `packages/verifier`. The new case
   has to be blocked for exactly the reasons you listed, and has to balance.
4. Regenerate the report from the repository root with
   `pnpm attack-examples -u`, and commit `REPORT.md` with the case.
5. Add a changeset for `@cardano-slips/verifier` (an empty one is fine when
   nothing under `src/` changed), as [CONTRIBUTING.md](../../../../CONTRIBUTING.md)
   describes.

A case is worth adding when it tells a lie no case here tells yet. Another
inflated amount of a different size is not one.

Cases are never removed or loosened to make the run pass. If one starts
failing, either the verifier broke or the case states something that has
stopped being true, and the pull request says which.
