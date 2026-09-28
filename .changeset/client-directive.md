---
"@cardano-slips/flow": patch
---

Mark the components as client components.

`slip-card` and `parameter-form` now open with `"use client"`, so a Next.js App Router page can import `SlipCard`, `SlipCardSkeleton`, `SlipCardError` and `ParameterForm` straight from a server component. Before this, the import failed the consumer's build on `useState`, and every Next.js site had to wrap the components in a client file of its own. The functions — balancing, wallet discovery, signing — carry no directive and stay callable from a server.
