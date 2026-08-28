# Architecture Decision Records

One file per decision, numbered in order: `NNNN-short-title.md`. Copy `0000-template.md` to start.

A decision recorded here is settled. Don't relitigate it in a PR or a code review — if it needs to change, write a new ADR that supersedes it and mark the old one `Superseded by ADR-NNNN`.

Write an ADR when a choice is hard to reverse, affects more than one package, or would otherwise be re-argued in three months: dependency choices, protocol shapes, security trade-offs, scope cuts. Don't write one for anything a linter or a type could have settled.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-client-side-balancing-default.md) | Client-side balancing is the only v1 build mode | Accepted |
| [0003](0003-mirror-evolution-sdk-toolchain.md) | Mirror the evolution-sdk toolchain | Accepted |
| [0004](0004-cip30-wallet-layer.md) | Build the CIP-30 layer on evolution-sdk, not cardano-connect-with-wallet | Proposed |
| [0005](0005-package-names.md) | Name packages for the job they do, not the tier they sit in | Accepted |
| [0006](0006-two-tier-publisher-identity.md) | Ship publisher identity in two tiers, with the domain manifest as the default | Accepted |
| [0007](0007-action-authority.md) | Claim `//action` as the URI authority, register it through CPS-16, and keep it out of M1 | Superseded by ADR-0008 |
| [0008](0008-rename-to-slips.md) | Rename the protocol to Cardano Slips and claim `//slip` | Accepted |
| [0009](0009-error-codes-and-versioning.md) | Classify failures by what a client does next, and version the protocol with a single integer per URL | Accepted |
| [0010](0010-cbor-decode-approach.md) | Decode transaction CBOR with our own strict reader, and keep CML as a test oracle | Accepted |
| [0011](0011-cip-title.md) | Title the CIP by its mechanism — Endpoint-Built Transaction Requests | Accepted |
| [0012](0012-decode-test-oracle.md) | Cross-check the decoder against the chain's own reading, not against CML | Accepted |

One more is already ticketed as a decision and lands here when made: the CIP-0170 go/no-go (#63), which ADR-0006 narrows to the Tier-2 question only.
