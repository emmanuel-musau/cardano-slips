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
Plain `http:` is accepted on a loopback host only. The served examples are on
preview, so connect a wallet switched to preview and funded from the faucet.

## Previews

Development builds only; both answer 404 in production.

- `/preview/effects` — every state the effects panel draws.
- `/preview/flow?uri=…&wallet=…` — the full flow against a scripted wallet that
  signs nothing real and submits nowhere. `wallet` is one of `signs`,
  `declines`, `funds-move`, `refuses`, `empty`, `testnet`.

## Protocol parameters

Before a run starts, the page reads `/parameters/<network>` from its own server.
That route asks evolution-sdk's Koios provider and keeps each network's answer
for ten minutes. Set `KOIOS_TOKEN` to send a Koios bearer token. Figures passed
to `SlipPage` as `parameters` are used instead, and nothing is fetched; a
static host that has no server does this. The slot-to-time mapping ships in
`src/slip-page/parameters.ts`. ADR-0015 has the reasons.
