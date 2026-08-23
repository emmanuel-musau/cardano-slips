# Requirements

Distilled from the design document. This file is the product source of truth for development; the CIP draft in `spec/` is the normative protocol text once written.

## 1. Problem

Every on-chain action on Cardano begins with leaving the current context: navigate to a dApp, connect a wallet, find the screen, fill a form, sign. Intent forms when a link is seen and dies before the dApp loads. There is no standard way to say "here is a specific thing to do on-chain, ready to sign" in a form that travels — X, WhatsApp, Telegram, SMS, a printed QR code.

Not for want of trying. CIP-13's `web+cardano:` scheme has nine registered authorities, and CIP-99 — Active, with five wallet implementations — already has wallets POST to a project's own server from a link. What none of them do is return a transaction for the user to authorise: the four that produce a transaction fix its shape in the URI, and CIP-99's server builds and signs its own. So a new kind of action means a new CIP and a per-wallet integration — and that price is not theoretical: CIP-13 itself has been `Proposed` with no listed implementors since 2020, and CIP-157, which only adds native assets to a payment link, has been an open PR since June 2024. See `docs/ECOSYSTEM.md` §1.

## 2. What we build

Three deliberately separate things:

- **Slip** — an HTTP endpoint hosted by the dApp. `GET` describes an intent (metadata); `POST` returns a **partial transaction** describing only the dApp's side.
- **Link** — a shareable URL pointing at a Slip, optionally fronted by a human marketing URL via `slips.json`.
- **Client** — anything that renders the link and drives the wallet handoff. M1 client: the slip page (desktop, CIP-30).

## 3. Protocol contract (v1)

### GET — discovery
Returns: `type`, `version`, `title`, `description`, `icon`, `label`, `network`, `links.actions[]` (each with `label`, `href`, optional `parameters[]` with `name/label/type/min/max/required`). Template placeholders like `{amount}` in `href`. Unavailable actions still respond with `disabled: true` and an `reason.message` — they render greyed out, never fail after the user commits.

### slips.json — domain mapping
Served from the domain root, CORS-enabled, and optional: `rules[]` of `pathPattern` → `apiPath` with `*` (one segment) and a trailing `**` (one or more). Lets `linktap.example/delegate/POOL1` resolve to the real endpoint while the shared link stays human. Both sides are **path-absolute** — the grammar cannot carry a host, so a mapping to another origin is unexpressible rather than forbidden, and the same-origin rule on `href` has no back door. Resolution is a **single substitution**: the result is never matched against the rules again.

### POST — build (Mode A, client-side balancing — the v1 default and only mode)
Request: `{ changeAddress, network }`. Response: `{ type: "partial", intent: { outputs, certificates, withdrawRewards, validUntil }, message }`. The client balances locally with evolution-sdk against the user's own UTxOs. **The endpoint never sees the user's UTxO set.**

Every quantity is an **integer count of base units as a string** — lovelace for ADA, raw on-chain quantity for a native asset — and no field carries decimals. The endpoint declares only what it chooses: the fee, certificate deposits, the stake credential, the reward balance and every key hash are supplied by the client, so there is no field in which an endpoint can state one wrongly. Declared lovelace is a *floor*: where it is under the ledger minimum the client raises it and shows the difference as its own effect.

Mode B (server-side balancing, client ships UTxOs) is reserved as `build: "server"` in the GET response but **out of scope for M1** — a v1 client renders the card, refuses to POST, and fails `UNSUPPORTED_BUILD_MODE`.

### Sign and submit
Client ends with a complete unsigned tx: derive effects → show → CIP-30 `signTx` (returns a **witness set**) → assemble witnesses into the body → `submitTx`. Short validity intervals plus automatic rebuild-and-retry when UTxOs move between build and sign.

The client records `BLAKE2b-256(canonical-cbor(tx_body))` — the transaction id — for the body it derived effects from, and assembles a returned witness set only into that body. A rebuild produces a new commit and re-derives effects before re-prompting. Witnesses are appended to any already present, never replacing them. This is internal to the client; endpoint authors never see it. It follows CIP-186's commit binding so the two agree on what identifies a transaction.

## 4. The effects engine — the security model

The server's metadata is a claim; the transaction is the truth. Before any signature request the client independently derives from the tx CBOR:

- net ADA delta for the user's addresses, and the exact fee
- net native-asset deltas per policy/asset
- certificates (delegate → pool, register/deregister + deposit), withdrawals
- mint/burn, validity interval (as wall-clock expiry)

Derived effects are compared against declared metadata. **Any contradiction hard-blocks signing** and shows the mismatch. This is why no gatekeeping registry is needed, and it is only possible because eUTxO transactions fully determine their own effects. The public **attack examples** — transactions whose metadata lies — with a proven 100% block rate are what make this claim credible.

## 5. Identity layer

Effects prove *what* a transaction does. Identity answers *who is asking* — and it ships in two tiers, because the assurance a regulated issuer needs and the assurance a creator posting a tip link needs are not the same thing.

**Tier 1 — domain attestation (the default).** A publisher serves a signed manifest at `https://<domain>/.well-known/cardano-slips.json` binding the domain to the Slip endpoints it vouches for. No chain write, no credential chain, no cost to publish. The client fetches it over the same origin it already resolved `slips.json` against and renders "published by `<domain>`, domain-verified". This is the tier every publisher gets, and its shape follows the origin-anchored precedent CIP-0186 set with `.well-known/cip30dl-attestation.json` rather than inventing a new one.

**Tier 2 — CIP-0170 attestation (high assurance).** A KERI `ATTEST` record anchors a digest of the publisher manifest in the issuer's KEL and publishes the reference in transaction metadata under label `170`. Through the ACDC credential chain this binds the endpoint to a legally recognised entity — vLEI-grade identity, valid only between `AUTH_BEGIN` and `AUTH_END`. Issued and resolved via `signify-ts`.

**What CIP-0170 does not give us, and we therefore define.** The CIP anchors a digest of *arbitrary* data; it does not specify a publisher payload, and it has no domain→AID discovery — nothing in it answers "given `linktap.example`, which identifier should I trust?". Both are ours to write, and Tier 1 is what answers the discovery half. Verification also depends on KEL availability: CIP-0170 concedes that watcher networks are not yet widely deployed and names OOBI over a known persistent channel as the interim path. Treat that as the live risk in this layer.

**Identity augments, it never gates.** A missing, invalid, expired or revoked attestation renders as unverified — visibly, at every tier. It never blocks a signature, and a verified publisher never relaxes the effects gate. The two mechanisms are independent by design: effects without identity leaves users approving correct transactions from unknown parties, and identity without effects is the central registry Solana needed and we are avoiding.

Tier 1 is in M1 unconditionally. Tier 2 carries an explicit go/no-go at end of Month 1 (issue #63) — it is pre-production and new to the team. Cutting it leaves the identity layer shipping, not absent, which is the point of splitting the tiers.

## 6. M1 scope (mainnet in 3 months)

**In:** spec + CIP draft; `core`; `server` with one adapter (Next.js); the `verifier` effects engine; the `flow` client SDK; hosted + self-hostable slip page; Tier-1 domain publisher attestation (Tier-2 CIP-0170 subject to the Month 1 go/no-go); AdaLink USDM/USDCx payment Slip live on mainnet; public attack examples.

**Deferred (roadmap — do not build in M1):** mobile CIP-13 `//slip` deep links; a CIP-186 transport for native mobile clients; browser extension inline rendering; server-side balancing (Mode B); additional framework adapters; additional Slip types.

On mobile, a shared link opened in a phone browser reaches a wallet through CIP-158 `//browse` — Active, with VESPR and Begin as implementors — which lands the slip page in the wallet's in-app browser where CIP-30 is injected and the desktop flow runs unchanged. Wallet URI handlers are unreliable in practice, so that entry is verified per wallet rather than assumed (#98), and the link always remains openable in the phone's own browser: the mobile story degrades to the desktop flow and never depends on a wallet's URI handler. CIP-186 is a separate case — the transport a *native mobile app* would use to be a client — and cannot carry the slip page, because its source-app attestation requires an installed app. See `docs/ECOSYSTEM.md` §3.

## 7. Reference integration — AdaLink

Stablecoin payment Slip: recipient, amount, USDM/USDCx choice; parameterised tip variant; human URLs (`/pay/HANDLE`) via slips.json. Declared metadata must exactly match derived effects. End-to-end on preprod first, then mainnet with transactions labelled with the registered message tag.

## 8. What shipping means (each one ticketed)

- Four packages published to npm under `@cardano-slips` with release notes and a fresh-install smoke test.
- Developer documentation: quickstart, `slips.json` and client integration guides, effects-model explainer, self-host walkthrough.
- Public attack examples with a 100% block-rate report, plus a wallet compatibility matrix run on preprod.
- CIP PR to `cardano-foundation/CIPs` — submitted after mainnet, documenting a running implementation.
- Usage measured from external wallets only; transactions we generate ourselves are recorded and never counted.

## 9. Non-goals, stated plainly

No custody, no treasury validator, no relayer, no fee tank, no central registry. The blast radius of a bug is a failed transaction, never a drained wallet. Nothing we ship requires ongoing funding to keep running.
