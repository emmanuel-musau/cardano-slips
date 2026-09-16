---
"@cardano-slips/flow": minor
---

`tokens.css` is one theme. The design sheet collapsed an earlier light/dark pair into a single ground that leans light, so `.slip-root[data-theme="dark"]` is gone and no role means two things any more. A component can no longer ask which theme it is in, which is the point: two components asking would eventually answer differently.

The ground moves with it — `--page` is `#ebeef8`, `--card` is `#fcfdff`, `--ink` is `#141a26`, `--muted` is `#56628a` — and the transaction preview becomes its own slate surface at `#222b3d` with `--vault-ink` at `#f5f7ff`, rather than the white it was in the old light theme. That one deep surface is what lets the rest of the client stay bright while the screen that judges the publisher still reads as grave.

`--on-accent` stays, because the sheet writes `#ffffff` inline on a button and a component cannot — `no-hard-coded-colours` forbids it. The `--dark-*` family stays too, and is now plainly a separate family rather than a value exempted from a theme: code blocks and the Open Graph card land on grounds we do not control, so they carry their own.

The contrast audit is recomputed from these values rather than copied off the sheet, whose printed ratios had gone stale against its own hexes. Every pairing a person reads clears AA, and two assertions are deliberately the other way round: `--accent-fill` must keep failing AA on a card, since that failure is the whole reason `--accent-text` exists, and it is held to fills on the vault even though it clears 4.6:1 there — the rule is about what the colour is for, not the ratio it happens to reach.
