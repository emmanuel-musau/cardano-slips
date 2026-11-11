# ADR-0015: Read protocol parameters from a chain provider through the page's own server, unless a caller passes them in

**Status:** Accepted
**Date:** 2026-09-30
**Issue:** #188

## Context

`completeIntent` needs the network's protocol parameters: the minimum-fee
coefficients, the per-byte cost, the deposits, the largest transaction size and
the slot-to-time mapping. Building the slip page, nothing said where the page
gets them, so it shipped a copy per network in `parameters.ts`, taken from Koios
by hand.

A shipped copy goes stale whenever governance changes a parameter. A stale
figure fails safe (the node refuses a fee or an output that fell short, and the
verifier blocks a deposit that no longer matches), but the page stops working
until someone rebuilds it.

evolution-sdk, which we already build transactions with, has an answer to the
same question. Every provider it ships (Blockfrost, Koios, Maestro, Kupmios)
has `getProtocolParameters()`, which returns one shape. The builder takes
figures passed in `fullProtocolParameters` first, and asks the configured
provider only when none were passed.

Two facts shaped how that carries over to a browser:

- **Public Koios can't be called from the page's browser code.** Its preflight
  allows any origin, but its actual responses carry no
  `Access-Control-Allow-Origin`, so a browser drops them. Checked from Chrome on
  2026-09-30. Blockfrost and Maestro need a secret key, which a browser bundle
  would hand to everyone.
- **The page already has a server.** It is a Next.js app, and the browser
  already trusts that origin for every line of code it runs.

## Decision

The page gets its parameters the way evolution-sdk does: **passed in, or else
from a provider.**

1. **Passed in wins.** `runSlip` and `SlipPage` take an optional `parameters`.
   Figures handed in are used as they are, and nothing is fetched.
2. **Otherwise the page's own server.** Before the flow starts, the browser
   reads `GET /parameters/<network>` from the origin that served it, once per
   run. It is not read again on a rebuild, and never during derivation. The
   answer is checked against a schema at the boundary. A failed or malformed
   answer stops the run on a notice that offers another try, before the wallet
   or the endpoint is asked anything.
3. **The route asks evolution-sdk's Koios provider** (`KOIOS_TOKEN`, if set, is
   passed as its bearer token). It keeps each network's answer for ten minutes
   and shares one call among requests that arrive while it runs. evolution-sdk
   itself keeps nothing, and asks the provider twice on every build.
4. **The slot-to-time mapping still ships.** It is set at genesis and changes
   only at a hard fork, and no provider's parameter shape carries it.

The chain provider is imported only under `src/app/parameters/`. A test fails
if browser code imports it.

## Alternatives considered

**Ship the figures with the build, as before.** No third party is involved, but
every governance change needs a release, and the page is broken from the change
until that release. The shipped copy was always meant to be temporary.

**Fetch from Koios in the browser.** This is the plain reading of "use the
provider", and it doesn't work: public Koios's responses fail the browser's
cross-origin check. It would also show Koios the visitor's IP and the moment
they pressed an action.

**Ship the figures, and fetch only to warn that the build is stale.** This keeps
the release cost and adds the fetch cost. A warning the person can do nothing
about isn't worth either.

## Consequences

- The page follows governance changes on its own, within ten minutes.
- The chain provider sees the page's server, not the visitor. The visitor's
  browser talks only to the page's own origin and to the Slip's endpoint.
- The source of the figures is no one new. It is the server that already ships
  the page's code, so a lying server could do far worse than misstate a fee.
  The route trusts Koios's answer. The fee it produces is shown in the effects
  panel before anyone signs, and a wrong deposit is refused by the node.
- A self-hoster needs a server, not static hosting. A static host passes
  `parameters` in and accepts the old release cost.
- If Koios is down and nothing is kept, no run can start. The page says so and
  offers another try. It doesn't quietly fall back to an old copy, because then
  nobody could tell which figures judged a transaction.
- Switching providers is a one-line change in `route.ts`, since every
  evolution-sdk provider has the same `getProtocolParameters()`.
