---
"@cardano-slips/flow": minor
---

Everything the slip page needs to go from a link to a receipt.

`fetchSlip` resolves a link through `slips.json` and reads the Slip; `requestIntent` asks for the partial intent with the change address and the network and nothing else. Both fail as one `ExchangeError` in the spec's vocabulary: the code, its class, the endpoint's own message only where its failure body was readable, and `Retry-After`. A link that is not `https:` fails as core's `InsecureSlipUrl` before anything is fetched. Both go through core's `boundedRequest`, so an answer too large to be a Slip or an intent is `UNREACHABLE`, and a redirect is refused before the change address can reach anyone the top bar does not name.

`completeIntent` takes two optional hooks. `confirm` holds the flow until the person presses sign, and is asked again for every rebuilt transaction; closing without signing ends it with the new `Cancelled` refusal. `onProgress` reports signing, submitting and rebuilding. Without either, it behaves as before.

`OutcomePanel` draws the states after sign is pressed — waiting on the wallet, declined, submitting, funds moved and rebuilding, refused by the network — with the effects still on screen and no way to sign from any of them. `SlipReceipt` is the receipt, on the card surface, with a link out to an explorer. `networkNames` is the one spelling of each network, for the receipt and the page's top bar alike. `tokens.css` gains `--on-warn` for words on the warning fill.
