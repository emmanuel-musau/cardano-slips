---
"@cardano-slips/flow": minor
---

Discover and connect a CIP-30 wallet. `discoverWallets` reads `window.cardano` on demand — never at module load, so the package stays importable in a page rendered on a server — and names a wallet from our own registry, letting one it does not know name itself. `connectWallet` enables, then holds the wallet to the network the Slip declares: the reported network id and the network its own change address encodes must agree with it and with each other, and a change address comes back as bech32 ready for the `POST` body. Failure is a typed refusal per state a person can be shown, and a declined connection keeps the wallet's own CIP-30 `{ code, info }` so `-3` stays distinguishable from a crash.
