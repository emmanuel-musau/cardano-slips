---
"@cardano-slips/flow": minor
---

`completeIntent` now asks the wallet which addresses are its own, on every attempt, instead of taking them from the caller.

It counts as the user's every address the wallet lists (`getUsedAddresses`, `getUnusedAddresses`, `getRewardAddresses`), the change address, and the address of every output the wallet said it holds. A caller that left one out used to have the wallet's own funds shown as someone else's. `userAddresses` is gone from `CompletionRequest`; drop it from any call. A wallet that will not answer, or names an address that cannot be read or is on another network, stops the flow with the new `UnreadableAddresses` refusal before anything is signed.

`readOwnAddress` is exported for reading one such address: any payment address, a reward account, or a Byron address an older wallet still reports.
