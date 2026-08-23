# Glossary

Terms used throughout the spec, issues, and code. Cardano-specific meanings, not general definitions.

**Slip** — an HTTP endpoint hosted by a dApp. `GET` describes an intent; `POST` returns a partial transaction. A server, not a library.

**slips.json** — a CORS-enabled file at a domain root mapping human URLs to technical endpoints (`/delegate/**` → `/api/slips/delegate/**`), so a shared link stays readable.

**Slip page** — the Tier-1 client: the page a Slip link opens. We host one; anyone can host their own. It runs the whole flow over CIP-30 and needs no cooperation from a wallet. Lives at `apps/page`.

**Attack examples** — transactions whose declared metadata contradicts what they really do, with evidence that 100% of them are blocked before signing. This is what turns the security claim from something we assert into something anyone can check.

**Balancing** — selecting inputs, computing change, and setting the fee so a transaction is valid. On eUTxO somebody must do it; we do it client-side (see ADR-0002).

**Base units** — the integer unit an on-chain quantity is actually denominated in: lovelace for ADA, raw quantity for a native asset. Declared metadata, derived effects and the mismatch comparison all work in base units; decimals are display only and never authoritative.

**CBOR** — the binary encoding of Cardano transactions. The `verifier` decodes it to derive what a transaction actually does.

**Certificate** — a transaction component performing a staking operation: stake registration (with a refundable deposit), deregistration, or delegation to a pool.

**Change address** — where a transaction's leftover value returns. Supplied by the wallet via CIP-30 and sent to the endpoint in the POST body.

**CIP-13** — Cardano's URI scheme (`web+cardano:`). Covers payment and stake delegation, and every extension registers an authority under it. Still `Proposed` with no listed implementors since 2020 — see `docs/ECOSYSTEM.md` §1 for why that matters. Our proposed `//slip` authority extends it; deferred to roadmap in M1.

**CIP-158** — the `//browse` authority: `web+cardano://browse/v1?uri=<percent-encoded https URL>` opens that URL in the wallet's in-app browser. Active, implemented by VESPR and Begin. Our mobile entry path, because CIP-30 is injected once the page loads there.

**CIP-30** — the browser wallet connector. Note the detail that trips people up: `signTx` returns a **witness set**, not a signed transaction. Witnesses must be assembled into the body before `submitTx`.

**CIP-0170** — KERI-backed on-chain attestations, anchoring a digest of arbitrary data in an issuer's Key Event Log and referencing it in transaction metadata. Tier 2 of the identity layer: it carries a publisher to a legally recognised entity, but defines no domain binding of its own — see **Publisher manifest**.

**Collateral** — UTxOs pledged to cover fees if a script fails validation. Relevant to Mode B and script-heavy Slips; out of M1 scope.

**Deposit** — refundable ADA locked by certain certificates, notably stake key registration (2 ADA). Shown separately from fees in the effects panel because the user gets it back.

**Derived effects** — what the `verifier` computes from a transaction body: ADA delta, per-asset deltas, fee, certificates, withdrawals, mint/burn, validity interval. Arithmetic, not simulation.

**Determinism** — on Cardano a transaction body fully determines its own effects and fee before submission. The property the entire security model rests on, and the one an account-model chain cannot copy.

**eUTxO** — Cardano's extended unspent-transaction-output ledger model. Source of both the input-selection constraint and the determinism advantage.

**Message tag** — a registered transaction metadata label identifying transactions produced through our integration, so real usage can be measured on-chain.

**Mismatch** — a contradiction between declared metadata and derived effects. Always hard-blocks signing; there is no override path.

**Mode A / Mode B** — client-side balancing (v1 default and only mode) versus server-side balancing (client ships its UTxO set; spec'd, declared, warned about, deferred). See ADR-0002.

**Partial transaction** — the `POST` response in Mode A: only the dApp's side of the intent (outputs, certificates, a reward withdrawal, validity), before the client balances it.

**Policy ID** — identifies a native asset's minting policy. Asset deltas are derived per policy + asset name; USDM and USDCx are each a policy.

**Preprod** — the Cardano test network used for all end-to-end work before mainnet.

**Publisher manifest** — the signed `.well-known/cardano-slips.json` document binding a domain to the Slip endpoints it vouches for. Tier 1 of the identity layer, and the payload a CIP-0170 attestation anchors. Proves *who* is asking, where effects derivation proves *what* happens.

**Reference integration** — AdaLink. Proves the SDK on a product with real users; not a library and not a template.

**Validity interval** — the slot range in which a transaction may be included. Rendered to users as a wall-clock expiry ("expires in 4m 12s"); short intervals plus rebuild-and-retry handle UTxOs moving mid-flow.

**Witness set** — the signatures and related data returned by CIP-30 `signTx`. Must be assembled into the transaction body before submission.
