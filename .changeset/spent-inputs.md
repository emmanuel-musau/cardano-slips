---
"@cardano-slips/flow": patch
---

After the node reports a spent input, the rebuild sets aside only the outputs it names when it gives their index, so another output of the same transaction stays available. A wallet left too short by what was just spent is reported as `WalletBehind` rather than `InsufficientFunds`. An `OutsideValidityIntervalUTxO` refusal that carries the node's slot is judged by that slot, so a slow device clock no longer turns an expired transaction into `WrongNetwork`.
