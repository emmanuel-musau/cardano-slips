# Security Policy

## Reporting a vulnerability

**Do not open a public issue.**

Report privately through GitHub:
[**Report a vulnerability**](https://github.com/emmanuel-musau/cardano-slips/security/advisories/new).
That creates a draft advisory only the maintainers can see, and it is the only
channel we watch for this.

If you cannot use GitHub advisories for some reason, say so in a public issue
**without any detail** — just ask for a private channel — and we will open one.

## What this project is responsible for

Cardano Slips turns a shared URL into a signable transaction. It holds no
funds, custodies nothing, operates no relayer, and runs no registry that the
protocol depends on. dApps host their own endpoints; the slip page is
self-hostable; the SDK is a library that runs on the user's machine.

So the interesting attack is not theft from a service we run — there isn't one.
It is this:

> **A user signs a transaction that does something other than what they were
> shown.**

A Slip endpoint's metadata is a *claim*. The transaction body is the
*truth*. The client derives the real effects from the CBOR and hard-blocks the
signature when the two disagree. Anything that defeats, weakens, or slips past
that derivation is the vulnerability class this project cares about most.

## In scope

Roughly in order of how much we want to hear about it:

1. **A metadata/effects mismatch that does not block signing.** Any transaction
   whose declared metadata lies about what it does, which the client would let
   a user sign. This is the top of the list by a wide margin.
2. **Wrong derivation in `packages/verifier`** — CBOR decoded into incorrect ADA
   deltas, fees, validity intervals, certificates, or multi-asset movements;
   change misattributed to the wrong party; a value movement not surfaced at
   all.
3. **Leaking the user's UTxO set** to a Slip endpoint, or any path that
   makes the client disclose wallet state it should keep local.
4. **URL and `slips.json` resolution flaws in `core`** that let one origin
   front an endpoint it should not be able to speak for, or that accept a
   payload the schema should reject.
5. **Attestation handling in `identity`** — an absent, invalid, or expired
   CIP-0170 attestation rendering as verified.
6. **Signing and submission in `flow` / `apps/page`** — a
   witness set assembled into a body other than the one displayed, a
   rebuild-and-retry that changes effects without re-showing them, or a
   submitted transaction that differs from the approved one.
7. **Supply chain** — a published package whose contents do not correspond to
   this repository.

A working proof of concept is not required. A transaction body plus an
explanation of what the client shows versus what it actually does is enough.

## Out of scope

- **Third-party wallets.** CIP-30 implementation bugs belong to the wallet
  vendor. Tell us anyway if the bug interacts with our signing flow.
- **[`@evolution-sdk/evolution`](https://github.com/IntersectMBO/evolution-sdk)**
  and other upstream dependencies — report those upstream. Again, tell us if it
  changes what our client would display.
- **Slip endpoints operated by other people.** A third-party dApp serving a
  transaction that contradicts its own metadata is the threat this design
  assumes, not a flaw in it. If our client blocks it, the system worked. If our
  client *doesn't* block it, that is item 1 above and very much in scope.
- **Operational issues in someone's self-hosted deployment** — missing rate
  limits, an unhardened reverse proxy, their own infrastructure.
- **Anything that requires the user's seed phrase, an already-compromised
  machine, or a malicious browser extension with full page access.**
- **Automated scanner output with no demonstrated impact**, and missing
  hardening headers on a page with no session and no secrets.

## Supported versions

Security fixes land on `main` and ship in the next release of each affected
package. Packages version and publish independently, so a fix in `verifier`
never waits on a `flow` release.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Latest minor of each package | Yes |
| Earlier minors | Upgrade to the latest minor |

## What happens after you report

These are the targets we hold ourselves to:

| Stage | Target |
| --- | --- |
| Acknowledgement that we received it | 3 business days |
| Initial assessment — severity, in scope or not | 10 business days |
| Fix, or a plan with a date if it is involved | Agreed with you, based on severity |
| Public advisory | After the fix ships |

We ask for up to 90 days before public disclosure, and will usually be far
quicker than that. If we go quiet past these targets, chase us — silence is a
failure on our side, not a policy.

You will be credited in the advisory by whatever name or handle you choose,
unless you would rather not be named. We do not run a paid bounty programme —
credit in the advisory is what we offer, and we would rather say so up front
than leave it ambiguous.

## Every valid report becomes a permanent test

A transaction that should have been blocked and wasn't is added to the
attack examples in `packages/verifier` as a regression test, and it stays
there. That is the most durable form the fix can take — it means the same class
of transaction can never quietly start passing again.

If you can include a failing test alongside the report, it is the single most
useful thing you can send.

## What to include

- The hex-encoded transaction body, and the Slip URL that produced it.
- The endpoint's declared metadata.
- What the client displayed, and what the transaction actually does.
- Network (`preprod` or `mainnet`), wallet, and package versions.
- A failing test, if you have one.
