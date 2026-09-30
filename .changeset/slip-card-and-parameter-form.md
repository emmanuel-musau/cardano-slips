---
"@cardano-slips/flow": minor
---

Add the Slip card and the generated parameter form.

`SlipCard` renders a decoded Slip: icon with the publisher's initial behind it, title, description, the host that served the link, and one button per linked action — or the single button `label` names when `links` is absent. `SlipCardSkeleton` holds the same box while the metadata is in flight and `SlipCardError` replaces it when the endpoint never answered.

The form is generated from what the endpoint declared. Bounds sit beside each field rather than only on failure, a value that fails `required`, `min` or `max` is caught before anything is sent in `core`'s own sentence, and a value the endpoint itself refuses lands on that field with the card left standing and what was typed still typed. A closed Slip closes every option under it, including one carrying `disabled: false`, and a closed option is rendered with its reason rather than hidden.

`card.css` is a new optional export carrying the design sheet's styling. Every element the components render is named with a class of ours and nothing else, so a consumer who skips the stylesheet can restyle the whole card.
