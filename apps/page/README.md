# The slip page

The hosted, self-hostable client a Slip link opens. The link arrives as
`?uri=<percent-encoded https URL>`, the name the spec's `//slip` authority gives
it, and the page runs the whole flow in the browser: resolve, read the card,
connect a wallet once an action is chosen, build locally, show the checked
effects, sign, submit, receipt.

## Running it

```sh
pnpm --filter @cardano-slips/example-slips build
pnpm --filter @cardano-slips/example-slips serve   # the example Slips on localhost:4010
pnpm --filter @cardano-slips/page dev              # the page on localhost:3000
```

Then open `http://localhost:3000/?uri=http%3A%2F%2Flocalhost%3A4010%2Ftip`.
Plain `http:` is accepted on a loopback host only.

## Previews

Development builds only; both answer 404 in production.

- `/preview/effects` — every state the effects panel draws.
- `/preview/flow?uri=…&wallet=…` — the full flow against a scripted wallet that
  signs nothing real and submits nowhere. `wallet` is one of `signs`,
  `declines`, `funds-move`, `refuses`, `empty`, `testnet`.

## Protocol parameters

`src/slip-page/parameters.ts` carries each network's parameters as they were
when the page was built, rather than fetching them from a third party. A stale
figure fails safe: the node refuses a fee or an output that has fallen short,
and the verifier blocks a deposit that no longer matches.
