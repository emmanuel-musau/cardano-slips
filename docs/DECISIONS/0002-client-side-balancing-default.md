# ADR-0002: Client-side balancing is the only v1 build mode

**Status:** Accepted
**Date:** 2026-08-19

## Context

eUTxO means somebody has to select transaction inputs, and Solana's Actions design gives no guidance because an account-model chain never faces the question. Two modes are possible:

- **Mode A** — the server returns only its own side of the intent (a *partial* transaction); the client balances locally against the user's UTxOs using evolution-sdk.
- **Mode B** — the client ships its UTxO snapshot to the server, which returns a complete unsigned transaction. Necessary for actions needing script inputs, datums, or reference inputs the client cannot discover.

Mode B hands a third-party server the user's entire UTxO set — a fingerprint of their whole wallet — just to click a button.

## Decision

Mode A is the only build mode implemented in v1. The spec reserves the Mode B declaration field in the GET response and specifies that servers MUST declare Mode B and clients MUST warn before using it, but neither `server` nor `flow` implements it in M1. Mode B is roadmap.

## Alternatives considered

**Ship both modes in M1.** Doubles the surface of the two riskiest packages while the effects engine is already the critical path. A narrow thing that works on mainnet beats a broad thing that does not.

**Drop Mode B from the spec entirely.** Script-heavy dApps genuinely need it, and a spec that cannot express their case invites incompatible extensions. Specifying it while deferring implementation keeps the door open without spending the days.

## Consequences

The privacy claim becomes structural rather than a policy promise: in v1 there is no code path that transmits a user's UTxO set to an endpoint, which is easy to verify and easy to state to reviewers. The eUTxO input-selection constraint converts into a privacy advantage over Solana rather than a drawback.

The cost is that script-heavy actions cannot be expressed in v1, so the AdaLink reference integration is limited to payments and certificate actions. When Mode B is implemented later, the client gains a warning path and a second balancing branch, and the attack examples need cases for server-built transactions — a real cost, deliberately deferred.
