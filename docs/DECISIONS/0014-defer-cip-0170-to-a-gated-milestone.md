# ADR-0014: Cut Tier 2 from M1 and gate it on conditions, not a date

**Status:** Proposed
**Date:** 2026-09-17
**Issue:** #60, decided by #63

## Context

ADR-0006 split publisher identity into two tiers and left the Tier-2 question —
whether CIP-0170 ships in v1 — open, to be answered by a spike against the real
tooling. This is what the spike found.

**The KERI half works.** Against a local KERIA agent, the three-witness demo pool
and the GLEIF vLEI server, `signify-ts` creates a publisher identifier, anchors a
digest of the Tier-1 manifest in its key event log as a witnessed interaction
event, and that seal reads back from the witness afterwards and matches. The
mechanism is real and it does what the CIP says it does.

Three things around it do not work.

**1. `AUTH_BEGIN` cannot be encoded as specified.** The event that grants an
identifier authority over label `170` carries its credential chain in `c: bytes`.
Cardano caps every metadatum byte and text string at 64 bytes
(`conway.cddl:819`, `bytes .size (0 .. 64)`). CIP-0170's own example chain,
`CIP-0170/example-credential-chain.cesr`, is 5,640 bytes. The CIP says nothing
about chunking, ordering or reassembly, so there is no interoperable way to write
the event that the rest of the protocol depends on. Without `AUTH_BEGIN` an
`ATTEST` record resolves to no authority, which renders as unverified — the same
as publishing nothing.

**2. A real attestation needs a vLEI.** The signer credential's edges block
requires `le`, an edge to a Legal Entity vLEI credential under schema
`ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY`. Required, not optional. So the
path to a verified badge runs: company registration → an LEI from an LOU → a
Legal Entity vLEI from a GLEIF-accredited issuer, with the verification ceremony
that accreditation implies → only then the metadata signer credential. None of
that is engineering work, none of it is on our schedule, and CIP-0170's own
acceptance criterion 3 — an independent identity verifier maintaining credential
chains for Cardano entities — is still unchecked by its authors.

**3. `signify-ts` cannot verify a key event log.** It signs at the edge: it
builds and signs events and hands them to a KERIA agent. Parsing and verifying a
KEL lives in KERIA, in Python. There is no CESR stream parser in the library at
all. A browser client therefore either carries a KEL verifier we write ourselves
— event signatures, witness receipts against the threshold, duplicity detection —
or it asks a KERIA agent whether a publisher is legitimate and believes the
answer. The second is the shape of dependency the effects gate exists to remove,
and without a deployed watcher network the publisher is also the one telling the
client where to find its own history.

`signify-ts` is at 0.4.0, nine releases since 2023, and describes itself as a
prototype. Every one of CIP-0170's four acceptance criteria is unchecked.

None of this makes CIP-0170 wrong. It is built for regulated issuers with an
infrastructure team, and the Cardano Foundation authoring it is a good sign for
where the ecosystem is going. It is not a thing a project shipping in M1 can
depend on.

## Decision

**Tier 2 leaves M1.** It returns as its own milestone, entered on conditions
rather than a date. Both must hold:

1. CIP-0170 specifies how a credential chain is carried within Cardano's 64-byte
   metadatum limit, in a way two implementations could agree on.
2. An identity verifier exists that a publisher like AdaLink can actually obtain
   a credential chain from — CIP-0170's own criterion 3.

The milestone — `Identity-Tier2 (gated)` — exists now and carries both conditions
in its description, so the deferral is visible on the board rather than only
here. It has no due date, because neither condition moves on our schedule. It
holds no tickets by intent: a parked ticket against a blocked dependency rots and
invites someone to start it. The first work item when the milestone is entered is
the KEL verifier, since `signify-ts` cannot verify a key event log.

**Tier 1 is unchanged and ships in M1**, exactly as ADR-0006 describes. #61 and
#62 stay in M1 narrowed to Tier 1: the domain manifest, its resolution, and the
publisher line beside the effects panel. Nothing user-facing is lost, because
identity never gated a signature — a verified publisher never relaxed the effects
check, and an unverified one always signed fine.

**The CIP draft describes Tier 1 normatively and names Tier 2 as an extension
point.** It must not read as though Tier 2 ships. The publisher identifier field
is reserved so that adding Tier 2 later is not a breaking change.

**We report the `AUTH_BEGIN` gap to the CIP-0170 authors.** Their criterion 4 is
that implementers report no blocking ambiguities. We are an implementer and we
found one, demonstrated against their own example file. This costs an issue
comment.

## Alternatives considered

**Ship Tier 2 in M1 anyway, self-attested.** An identifier with no credential
chain can publish `ATTEST` records today — the spike did exactly that. But
CIP-0170 grants such an identifier no authority, so it correctly renders as
unverified. We would be paying a chain write per manifest, running a KERIA agent
and a witness pool, to display the same badge Tier 1 displays for free. Rejected:
it buys nothing and it teaches users that the badge means less than it says.

**Write the KEL verifier now and take the rest later.** Tempting, because it is
the only part that is genuinely ours to build and it is the part that decides
whether the badge can be trusted. Rejected on sequencing, not on merit: a
verifier with nothing valid to verify cannot be tested against real credential
chains, and building it before the chunking question is answered risks building
against a shape that changes. It is the first thing the gated milestone does.

**Keep Tier 2 in M1 but marked at risk.** Rejected. "At risk" work in a milestone
still gets picked up, still gets estimated, and still gets reported on. The
dependencies here are a company registration and a spec fix — neither moves
because a milestone says it should.

**Drop CIP-0170 permanently.** Rejected, and this is the difference between this
ADR and a no-go. Domain control proves someone holds DNS, not who they are. For
the stablecoin and merchant cases this project aims at, a path to legal identity
is what separates a demo from something a regulated counterparty can use. The
alignment with the Cardano Foundation's identity work costs us nothing to keep
while it matures.

## Consequences

M1 gets smaller and finishes cleaner. The identity layer still ships — ADR-0006's
two-tier split is what makes that true, and this is the scenario it was written
for. A no-go before that split would have left M1 with no identity story at all.

We give up being the implementation that ticks CIP-0170's criterion 2,
"identity-bound actions", at least for now. That was worth something in the
relationship with the authors. Reporting the `AUTH_BEGIN` gap recovers part of
it: being the implementer who found the blocking ambiguity is its own kind of
contribution, and it is the honest one.

Reversing this is cheap by construction. Tier 2 sits on top of Tier 1 rather than
beside it, so nothing shipped in M1 has to be unbuilt — the manifest is already
the payload a future attestation would anchor, and `packages/identity` is already
a separate package precisely so that cutting Tier 2 is deleting a dependency line
rather than untangling code. ADR-0006 called that split a scope-risk hedge. This
is the risk it hedged.

The live risk this leaves is the one ADR-0006 named: tier ordering is hard to
reverse once the CIP is public. Our draft says Tier 1 supplies the domain→
identifier discovery CIP-0170 omits. If CIP-0170 later grows its own discovery,
Tier 1 becomes redundant rather than foundational and clients written against it
need rewriting. Deferring the build does not defer that exposure, which is why
this decision is recorded now rather than when the work is scheduled — the CIP PR
(#71) has to be filed knowing it.
