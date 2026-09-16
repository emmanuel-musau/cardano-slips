---
"@cardano-slips/flow": minor
---

`completeIntent` is the whole path in one call: read what the wallet holds, build against it, derive what the built transaction does, compare that with what the endpoint declared, sign, submit. It answers with the transaction id, the effects a person was shown, and how many attempts it took.

UTxOs spent between building and signing are the flow's main real-world failure, and they are the one submission failure worth repeating. On `InputsSpent` the transaction is built again from the wallet's fresh outputs — and everything downstream happens again with it. A rebuilt transaction is a different transaction with a different id, so its effects are derived again and compared again before the wallet is asked for a second signature; a re-prompt against effects derived from the body that just failed would be a signature for something nobody read. Rebuilds are bounded, three by default, and every other submission failure fails on the spot rather than putting a second signature in front of someone for a reason no rebuild can fix.

A mismatch hard-blocks here, in the error channel, with the reasons attached for the block to render and no field on the error that lets anyone past — invariant 3 where the signing actually happens rather than only in the UI that shows it. `CompletionError` also covers a wallet that holds nothing, a wallet that will not say what it holds or answers unreadably, and a transaction whose effects cannot be derived or compared — the last of which is reachable in practice: a wallet answering with the same input twice at two different values. `onAttempt` is where the caller puts the effects in front of a person, so a callback that throws fails closed as a refusal rather than escaping as a stack trace: nothing is signed that nobody was shown.

`asResolvedInputs` converts the wallet's own unspent outputs into the values the derivation is handed. The engine never looks an input up (invariant 1), so this is where the client, which does know what it holds, says so — assets included, since a value read short understates what leaves the wallet.
