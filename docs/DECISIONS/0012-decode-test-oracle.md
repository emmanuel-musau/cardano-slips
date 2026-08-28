# ADR-0012: Cross-check the decoder against the chain's own reading, not against CML

**Status:** Accepted
**Date:** 2026-08-26
**Issue:** #35

## Context

ADR-0010 decided that `verifier` reads transaction CBOR itself, and named CML as
the second opinion: a `devDependency` whose reading of fee, outputs,
certificates and withdrawals every fixture would be checked against. That part
of the decision was made before any fixture existed.

Collecting the fixtures changed what was available. Building `decode.ts` meant
pulling real transactions from a public explorer anyway, and Koios answers two
questions at once: `tx_cbor` gives the bytes, and `tx_info` gives that same
transaction already read — fee, inputs, outputs and their totals, certificates
by type, withdrawals, minted and burned assets, the validity interval,
collateral and reference inputs, votes and proposals.

That reading is produced by `cardano-db-sync`, which decodes with the Haskell
ledger library the node itself uses. As an independent opinion it is at least as
good as CML's, and closer to the thing being conformed to.

Two facts settled it. Roughly seventeen hundred mainnet transactions were read
while collecting the fixtures; every one decoded, agreed with the chain's
reading on every field above, and hashed to its own transaction id. And CML is a
WASM blob with manual memory management and separate node and browser builds —
a cost ADR-0010 was already unwilling to pay in the shipped package, and one
that buys less in the test suite now that a second reading arrives with the
bytes.

## Decision

**The oracle is the chain's own reading, recorded at collection time.** Each
file in `packages/verifier/test/fixtures/` carries the transaction id, the CBOR,
and a `chain` block holding what Koios said the transaction does. The tests
compare the decoder's answer against that block. Nothing is fetched while tests
run — the readings are frozen in the fixture, so the suite is offline and a
fixture cannot change meaning because an explorer changed.

**CML is not a dependency of this repository, in any form.** ADR-0010's CML
clause is superseded by this one. The rest of ADR-0010 stands unchanged: our own
strict reader, no runtime CBOR dependency, and the commit taken over the
original body slice.

**The commit check is still the one that carries the most weight.** BLAKE2b-256
over the extracted body byte range must equal the known transaction id for every
fixture. It needs no oracle at all, and it fails if the body's boundaries are
off by a single byte.

**A shape the chain did not supply gets a test built from the CDDL, labelled as
one.** Committee certificates, the four combined registration-and-delegation
certificates, reference scripts in an output and a treasury donation did not
appear in the transactions collected. `test/decode-shapes.test.ts` builds those
from the written rules with a test-only CBOR writer, and says in its own header
that they are shape tests with no commit to check. Real bytes for them are
criteria on the honest-fixtures ticket (#40).

## Alternatives considered

**Add CML anyway, and cross-check against both.** More coverage on paper. In
practice it re-checks the same six fields the chain reading already covers,
while adding a WASM devDependency, a second install cost in CI, and test code
written around manual memory management. The one thing it would catch that the
chain reading does not — a field where `db-sync` and CML disagree — is a
disagreement between two implementations of the ledger rules, not evidence about
ours.

**Keep CML for the fields the explorer does not expose.** The gap is narrow: the
explorer reports certificates by type but not their contents, and governance
actions by count. Those are read by `test/decode-shapes.test.ts` against the
CDDL instead, which is the same authority CML is built from and is legible in
the test.

**Fetch from the explorer during the test run.** Removes the recorded block and
the risk of it going stale. It also makes the suite depend on a service being
up, makes a test failure ambiguous between a bug and an outage, and puts a
network call inside the package whose whole claim is that it makes none.

## Consequences

**What this makes easy.** The suite is offline, deterministic and fast, and the
`verifier` package still has exactly one class of runtime dependency. Adding a
fixture is a matter of pulling two Koios responses and writing one file, which
is what #40 has to do fifty times.

**What this makes hard.** The recorded readings are a snapshot. If the explorer
were wrong about a transaction, we would inherit that and not notice — mitigated
by the commit check, which no explorer supplies, and by the fixtures being real
mainnet transactions whose ids are public.

**What it forecloses.** Nothing structural. CML could be added later as a third
opinion without touching `src`, and the fixtures are already in the shape such a
check would read.
