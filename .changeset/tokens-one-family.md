---
"@cardano-slips/flow": minor
---

Refresh `tokens.css` against the design sheet: one typeface, a recoloured accent, and outlined buttons.

**One family.** `--font-display`, `--font-text` and `--font-mono` are gone, replaced by a single `--font`. The sheet now sets everything in Poppins, and three names for one face is three chances to drift apart — what separates a title from a label is weight and size. `--type-mono` is now `--type-technical`: the role still means an address, a hash or an error code, but it is no longer set in a monospaced face and the name said otherwise. `--type-body` drops to weight 400.

**A new accent.** `--accent-text` and `--accent-action` are both `#123cd3`, `--accent-hover` is `#0e2fa6`, and `--focus` follows the accent. The semantic three are recut — `--pos` `#065708`, `--warn` `#7a5200`, `--bad` `#d20a19` — along with their tints, their lines and their counterparts on the preview surface. Two tokens are new: `--warn-fill` for the warning as a fill, and `--accent-on-slate` for an accent-coloured word on the preview, where the ordinary accent disappears into the ground.

**Outlined buttons.** The card's actions now carry the accent as their label and edge rather than as a fill, so `--on-accent` is no longer what a button's text is drawn in.

One value departs from the sheet on purpose. `--vault-bad` is `#ff5a50` here rather than the sheet's `#ff5247`, which measures 4.42:1 against the preview surface under a row the sheet labels a pass. That colour carries the mismatch block, so it clears AA or it does not ship; the audit is recomputed in the tests rather than copied, which is what caught it.
