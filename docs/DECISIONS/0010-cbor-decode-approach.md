# ADR-0010: Decode transaction CBOR with our own strict reader, and keep CML as a test oracle

**Status:** Accepted
**Date:** 2026-08-23
**Issue:** #33

## Context

`packages/verifier` derives what a transaction does from its bytes, and
`decode.ts` is the first step: CBOR in, a structured Conway transaction out.
Everything downstream — the ADA delta, the fee, the certificates, the mismatch
verdict that blocks a signature — is arithmetic over whatever that step returns.
A field the decoder drops is an effect the user never sees.

Three approaches were on the table: reuse the decoder inside
`@evolution-sdk/evolution`, call CML directly, or read the CBOR ourselves.

The ticket's criteria — API fit, bundle size, browser support, maintenance —
are real but do not separate the three. Four requirements do, and only one of
them was written down before this work started.

**The decoder must fail closed.** A map key we do not model, a certificate type
that appeared in an era after we shipped, an output shape we do not recognise:
none of these may be skipped. Each has to raise, and `compare.ts` has to turn
that into a block. A decoder that tolerates what it doesn't understand is a
decoder that lets an undeclared effect through, and undeclared effects are
always a mismatch. Leniency is the default behaviour of general-purpose CBOR
libraries, because leniency is what most callers want.

**The commit must hash the bytes we were given.** `flow` holds
BLAKE2b-256 of the transaction body and assembles witnesses only into that body.
If we hash a re-encode of our parsed structure rather than the original slice,
any transaction whose body was not encoded exactly the way we would encode it
yields a different transaction id than the chain will compute. The decoder
therefore has to hand back the body's byte range, not only its parsed contents.

**The result must join against the user's own UTxOs.** A net ADA delta needs the
value of the inputs being spent, and the body carries only references to them.
In Mode A the client balanced the transaction from its own UTxOs, so it holds
those values — but that makes the verifier a function of (tx CBOR, declared
metadata, user addresses, **resolved inputs**), one term more than
`ARCHITECTURE.md` currently states. Correcting that is a separate ticket; the
decode API has to make the join cheap either way.

**`verifier` should stay adoptable on its own.** A wallet or an explorer using
it without the rest of the protocol is an argument in the CIP. That argues
against carrying a large transaction-construction library behind it.

### What the proof established

A throwaway reader — 90 lines of CBOR, 123 lines of Conway body — was run
against three real mainnet transactions pulled from Koios:

| Transaction | What it exercised |
|---|---|
| `e1a50728…` | Conway `reg_cert` + `stake_delegation` + `vote_deleg_cert` in one body, five legacy outputs |
| `682b0042…` | a withdrawal, two legacy outputs |
| `e947fe74…` | eight post-alonzo map outputs and one legacy output in the same transaction, auxiliary data present |

Outputs, fee, certificates, withdrawals and the validity interval all read
correctly. The check that matters most: **BLAKE2b-256 over the extracted body
byte range equals the transaction id the chain reports**, for all three. That is
a stronger oracle than it sounds, because it is end-to-end — it fails if the
body boundaries are off by a single byte.

Seven malformed or unmodelled inputs were all rejected, each with a distinct
error: an unknown body key, a certificate type mutated to an unmodelled value in
an otherwise real transaction, an unexpected tag, trailing bytes, truncation, a
float in the body, and a body that is not a map.

Two things the proof taught that would otherwise have been found late:

- **A CBOR map and a CBOR array must be distinguishable in the decoder's own
  representation.** The first version returned a plain array for both, and a
  post-alonzo output — a map — was read as a legacy output — an array — and
  produced garbage rather than an error. Post-alonzo and legacy outputs differ
  by nothing except major type, and both appear in the same real transaction.
- **CIP-0186's published CBOR vectors are shape tests, not transactions.**
  `cbor_001` hashes `a0` and `cbor_002` extracts a body from `84a0a0f5f6`. They
  pin the extraction rule and the hash operation, and both pass — but
  `ARCHITECTURE.md`'s claim that the fixtures can be "seeded from CIP-0186's
  published vectors" oversells them. Real transactions have to come from the
  chain, checked against CML.

## Decision

**`decode.ts` reads the CBOR itself. No runtime CBOR dependency.**

The reader is a byte-range-preserving parser over RFC 8949 major types, plus a
Conway body reader on top of it. Two reasons a general-purpose library does not
fit: they decode to plain JavaScript values and discard the byte offsets the
commit needs, and their strictness is tuned for interoperability rather than for
refusing the unknown. We need one direction, one grammar, and the opposite
default. Reading is a far smaller job than writing, and the proof puts the whole
thing at roughly 200 lines.

**The rules the reader enforces, each of which raises rather than skips:**

- an integer body key that is not in the modelled set — this is what era drift
  looks like from inside the decoder
- a duplicate body key
- a certificate type not in the modelled set
- an output that is neither a legacy array nor a post-alonzo map, or a
  post-alonzo output carrying an unknown key
- any tag other than 258 (the Conway set tag)
- a float or an unmodelled simple value anywhere in the body
- trailing bytes after the transaction, or truncation
- a body that is not a map, or a transaction that is not a 4-item array

**The commit is BLAKE2b-256 over the original body byte slice, never over a
re-encode.** `decode.ts` returns that slice alongside the parsed body. We never
need a CBOR *encoder* in `verifier` at all, which removes the whole class of
round-trip bugs.

**Hashing comes from `@noble/hashes`** — pure TypeScript, no dependencies,
audited. Node's `crypto` offers `blake2b512` and `blake2s256` but not
BLAKE2b-256, and browsers have no BLAKE2b at all, so a library is required
whichever way we go.

**CML is a `devDependency` and is never shipped.** Its job is to be the second
opinion in tests: for every fixture, CML's reading of fee, outputs, certificates
and withdrawals must agree with ours. That gives the independence argument
without putting WASM in the security path.

**Tests that land with the implementation** (`test/fixtures/`, per the testing
bar in `CLAUDE.md`):

- every fixture's derived commit equals its known transaction id — the
  end-to-end check above, and the cheapest regression net we have
- every fixture cross-checked against CML for fee, outputs, certificates,
  withdrawals, mint and validity interval
- one rejection test per fail-closed rule listed above, including the mutated
  real transaction — a decoder that stops rejecting is the failure mode that
  silently disarms the whole engine
- CIP-0186 `cbor_001` and `cbor_002` as conformance checks on extraction and
  commit, described as what they are

## Alternatives considered

**Reuse the decoder in `@evolution-sdk/evolution`.** No new dependency and
guaranteed agreement with the builder — and that agreement is the problem. In
Mode A the client balances with evolution-sdk, so reading the result back with
the same library means an encode/decode asymmetry inside it is invisible to us.
The engine that checks the builder's work should not use the builder's own eyes.
It also gives no byte ranges and no control over what happens on an unknown
field.

**Call CML directly and ship it.** Complete Conway coverage, actively
maintained, and the closest thing to a reference implementation in reach. It
loses on everything else: a WASM blob inside the package whose security claim is
its whole point, separate browser and node builds, manual memory management, and
a bundle cost paid by every slip page. It also does not expose the body's byte
range. Keeping it as a test oracle takes the benefit and leaves the cost.

**A general-purpose CBOR library (`cborg`, `cbor-x`) plus our own body reader.**
The closest alternative, and it was the original recommendation. It loses on the
two requirements that decide this: no byte offsets, and a leniency default we
would have to fight rather than inherit. It saves perhaps 90 lines and adds a
dependency and a supply-chain surface to a package that is supposed to be small
enough to audit by reading.

## Consequences

**What this makes easy.** `verifier` stays a small pure-TypeScript package with
one tiny runtime dependency, which is what makes "a wallet could adopt just
this" a credible sentence in the CIP. Fail-closed is a property of code we own
rather than a hope about a library's defaults. The commit is right by
construction because we never encode anything.

**What this makes hard, and it is the real cost.** Every era that adds a
transaction-body field, a certificate type, or an output shape lands on us as a
wave of `UNKNOWN_BODY_KEY` errors. That is the correct behaviour — the
alternative is deriving effects from a transaction we only partly understand —
but it means an era change is a release-blocking task for this package, not
something that arrives for free with a dependency bump. The CML cross-check is
what tells us *which* field we are missing, which is exactly why it stays.

**What it forecloses.** Nothing structurally: the reader sits behind
`decode.ts`, and swapping in CML later would be a change inside one module with
the fixtures already in place to prove the swap was faithful. The genuinely
expensive thing to reverse is the fail-closed contract, because `compare.ts` and
the attack examples are written against it — but that contract is the product,
not an implementation detail.

**Follow-on work, filed rather than absorbed.** The verifier's stated signature
needs the resolved-inputs term added (#107). The shapes this decision names but
the proof did not reach — native assets, mint and burn, reference inputs,
collateral, and governance procedures — are criteria on the existing fixture
ticket (#40), and the fail-closed rejection tests are criteria on the decode
ticket (#35), whose round-trip criterion this ADR replaces with the commit
check.
