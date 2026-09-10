---
"@cardano-slips/flow": minor
---

Add `tokens.css` — colour, type, spacing and radius as CSS custom properties, taken from the design sheet. Scoped to a `slip-root` class rather than `:root`, because a package dropped into someone else's page must not redefine what that page already calls `--ink`; there is no reset in it and no rule that selects an element, so an inherited font stack survives. `data-theme="dark"` is the whole of the theme rule, rebinding the roles so a component writes `var(--ink)` once and is right in both themes — with the fixed dark palette for code blocks and the Open Graph card deliberately outside it, since a value that is fixed cannot also follow. Exported as `@cardano-slips/flow/tokens.css`, so the hosted page and a third party resolve the same file. Two tests hold it: nothing outside the token file writes a colour, and the sheet's contrast audit is recomputed against the values rather than copied in.
