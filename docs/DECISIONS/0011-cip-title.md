# ADR-0011: Title the CIP by its mechanism — Endpoint-Built Transaction Requests

**Status:** Accepted
**Date:** 2026-08-25
**Issue:** #21

## Context

ADR-0008 renamed the protocol to Cardano Slips and claimed `//slip`, and left one
thing open in writing: *"The CIP title stays a separate decision. Following
CIP-45, the title describes the mechanism rather than carrying the brand, and it
must distinguish this proposal from CIP-186, 'Cardano Wallet Deep-Link Signing',
which is adjacent territory."*

The draft carried `Title: Cardano Slips` as a placeholder until the shapes froze.
Freezing them (#21) is the last moment the title is free: after the CIP PR is
filed, third parties cite it.

Two constraints are already settled and both bear on the title. The proposal must
not read as a URI extension, because the URI is the roadmap half and the CIP must
reach Active without any wallet adopting an authority. And it must not be
mistaken for CIP-186, which is a transport for signing over deep links — a
neighbouring problem with a similar-sounding name.

## Decision

**The CIP is titled *Endpoint-Built Transaction Requests*.** The brand stays in
the Abstract's first line and in the authority; the title says what the protocol
does that no registered authority does — an endpoint builds a transaction and the
person authorises it.

CIP-45 is the precedent for the split: its library is Cardano Peer Connect and
its CIP is titled *Decentralized WebRTC dApp-Wallet Communication*. A brand in a
title asks a reader to know the brand first.

## Alternatives considered

**`Cardano URIs - Slip Extension`.** Matches the naming pattern of the family the
authority registers into — CIP-99 *Token Claim Extension*, CIP-158 *Browsing
Extension* — and would read to editors as a sibling. Rejected because it frames
the proposal as a URI extension, which is the half that is deferred. A reviewer
reading that title looks for wallet URI support in the acceptance criteria, finds
none, and is right to ask why; a title should not create the objection the
document then has to answer.

**`Cardano Slips`.** What the draft carried. Rejected on ADR-0008's own reasoning,
which had already chosen the CIP-45 split and only deferred the wording.

**`Shareable Transaction Links`.** Says what a person sees rather than what the
protocol does, and collides directly with CIP-186's territory — a deep link is a
shareable transaction link too. The distinguishing fact is who builds the
transaction, so that is what the title carries.

## Consequences

The title does not contain the word slip, so a reader arriving from the authority
or the npm scope needs one line to connect them. The Abstract's first sentence is
that line, and the authority section names both.

It also means the CIP is searchable by the thing it does rather than by our name
for it, which is the right trade for a document whose audience is people who have
not heard of us.

Reversing this is cheap while the draft is unfiled and effectively impossible
afterwards, which is why it is decided here rather than at submission (#71).
