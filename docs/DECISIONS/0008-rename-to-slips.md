# ADR-0008: Rename the protocol to Cardano Slips and claim `//slip`

**Status:** Accepted
**Date:** 2026-08-21
**Supersedes:** [ADR-0007](0007-action-authority.md)
**Issue:** TBD — lands with the CIP draft.

## Context

ADR-0007 chose `//action` as the URI authority and accepted, in writing, that
`action` is loaded vocabulary on Cardano. It named the exact circumstance under
which the decision should be revisited: *"If that collision proves genuinely
confusing in review, the rename is a find-and-replace across `spec/` while the
CIP is a draft. After the CIP PR is filed it is effectively permanent."*

That circumstance arrived before review rather than during it, and the collision
is wider than ADR-0007 priced it. Since Conway, "action" is not one compound
noun but a cluster of ledger vocabulary: `GovActionId` identifies a proposal,
`govActionDeposit` and `govActionLifetime` are protocol parameters,
`cardano-cli conway governance action create-*` is the command surface, and
"Governance Actions" is a top-level section in GovTool and the explorers.

The practical cost is not machine ambiguity — a versioned authority parses fine
— but the bare noun. In a Cardano room, "an action" resolves to a governance
action, and `//action` would have sat directly beside `//drep` in the registry.
The audience for this CIP is wallet and dApp developers and the CIP editors, who
are precisely the people for whom the word is already taken.

Nothing is filed and there are no external implementers, so the rename costs a
sweep now and is unavailable later.

ADR-0007 also assumed one word had to serve as product name, npm scope, spec
noun and authority, and rejected `//intent` on that basis. CIP-45 shows the
assumption is unnecessary: its library is **Cardano Peer Connect** and its
authority is `//connect`, with the CIP itself titled by mechanism. The brand's
last word *is* the authority; the CIP title is free to describe.

## Decision

**The protocol is Cardano Slips and the authority is `//slip`**, versioned as
`web+cardano://slip/v1/...`. A slip is a written record of a transaction — a
thing you read before you sign it, which is exactly the behaviour the mismatch
block enforces. Org, npm scope and authority align as singular and plural of one
word.

**The GET discriminator becomes `"type": "slip"`.** It names the whole document,
and leaving `"action"` inside a Slip would preserve the confusion being removed.

**`links.actions[]` and `linkedAction` keep their names.** A Slip offers up to
three actions; those are choices *within* one Slip, not Slips of their own.
Renaming them to `slips[]` would have made the containment relationship
nonsense, and it keeps the shape recognisable to anyone arriving from Solana's
Actions.

**Earlier ADRs are not edited.** They record what was decided when it was
decided, including the name in use at the time. This ADR is the only place the
rename lives, so it is also where the reading is written down. Every name an
earlier record carries is read through this table:

| Written in an earlier ADR | Read as |
|---|---|
| `//action` | `//slip` |
| `"type": "action"` | `"type": "slip"` |
| `@cardano-actions/*` | `@cardano-slips/*` (ADR-0005) |
| `.well-known/cardano-actions.json` | `.well-known/cardano-slips.json` (ADR-0006) |
| an *action endpoint*, an *action* as the whole document | a **Slip endpoint**, a **Slip** |

Where a current document and an earlier ADR disagree about a name, the current
document is right and the ADR is not wrong — it is dated. `docs/REQUIREMENTS.md`
is where the publisher manifest's filename lives today.

## Alternatives considered

**`//deed`.** A deed is both the act and the signed instrument that effects it,
which is the sharpest available double meaning. Rejected narrowly: ERC-721's
early drafts called NFTs "deeds", and the legal-instrument register reads colder
than the product warrants.

**`//writ`.** Semantically exact and entirely unclaimed, but a writ commands,
and this flow is consented. The coercive register misdescribes the relationship.

**`//intent`.** Clean on Cardano and already the protocol's own word for the
POST response. Rejected on the ecosystem-wide meaning rather than ADR-0007's
identity argument: "intents" in DeFi denotes solver networks and third-party
fillers. Where the governance collision confuses which layer the protocol sits
at, this one would confuse the security model, which is the worse trade for a
project whose invariants are no registry, no custody and no relayer.

**`//capsule`.** Good sound, clean availability, wrong idea. A capsule is defined
by being sealed; the entire claim here is that a client can prove what is inside
before signing. The name would argue against the product in every sentence.

**`//packet`.** Rejected on a live collision: *packet* is the core noun of Cosmos
IBC, where packets move between chains via **relayers** — the one component this
architecture is defined by not having. The Cardano Foundation is actively
building IBC, so the term is inside Cardano's own current roadmap.

## Consequences

**The accepted cost: SLIP is a wallet-standards acronym.** SLIP-0039 and
SLIP-0044 are SatoshiLabs Improvement Proposals, and SLIP-0044 is where
Cardano's coin type `1815'` is registered — cited by CIP-0003, CIP-1854 and
CIP-1855. Spoken aloud in a wallet-standards conversation, "the Slip spec" and
"the SLIP spec" are the same sound, and `slips.json` sits a search away from
SatoshiLabs' `slips/` repository.

This is narrower than the collision it replaces, and the reason is worth stating
because it is what makes the trade sound. Nobody says "a slip" to mean a
SatoshiLabs document; they say "SLIP-44", always with a number. The bare noun
stays unambiguous, which is the thing "action" could never manage. The collision
lives at the acronym, where context disambiguates, rather than at the common
noun, where it does not.

**The CIP title stays a separate decision.** Following CIP-45, the title
describes the mechanism rather than carrying the brand, and it must distinguish
this proposal from CIP-186, "Cardano Wallet Deep-Link Signing", which is
adjacent territory. That is still open.

**The GitHub organisation, repository and npm scope move with this.** The npm
org `@cardano-slips` exists; the repository rename and remote update are manual
steps recorded with the change rather than performed by it.
