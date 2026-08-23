# Ecosystem

The Cardano standards this project sits among: what each one does, what we take from it, and what we leave alone. Surveyed 2026-08-20 against `cardano-foundation/CIPs`, refreshed 2026-08-22 against [issue #836](https://github.com/cardano-foundation/CIPs/issues/836) — the ecosystem's running meta-issue on the URI scheme, and the source for most of §1.

Read this before writing spec text or arguing that something doesn't exist. Most of what looks like a gap turns out to be something already built for a neighbouring purpose, and saying so first is cheaper than being corrected in public.

## 1. The `web+cardano:` family

CIP-13 defines the scheme; every extension registers an authority under it. CPS-16 is the coordination point.

| Authority | CIP | Status | What it does |
|---|---|---|---|
| *(none)* | CIP-13 | Proposed | Address plus optional lovelace amount |
| `//stake` | CIP-13 | Proposed | Pool delegation |
| `//claim` | CIP-99 | **Active** | Token claim: wallet POSTs to a project server, server pays out |
| `//transaction`, `//block` | CIP-107 | Proposed | Historical reference |
| `//addr` | CIP-134 | Proposed | Address reference |
| `//connect` | CIP-45 | Active | WebRTC peer pairing |
| `//browse` | CIP-158 | **Active** | Open a URL in the wallet's in-app browser. Implementors: VESPR, Begin |
| `//drep` | CIP-162 | Proposed | DRep delegation |
| `//pay` | CIP-157 | Draft — PR 843, unmerged since 2024-06 | Payment with native assets and metadata |
| `//slip` | *ours* | Unclaimed | An arbitrary intent, built on demand by an endpoint |

Nine are registered — CPS-16 lists eight and omits `//connect`. Four of them produce a transaction, and each fixes its shape in the URI with a defined set of query parameters; the rest reference chain data, open a browser, or pair a peer. None returns a transaction a publisher composed. Adding a new kind of action therefore means writing a new CIP and persuading each wallet separately. That is the gap, and it is the whole argument.

**The registry is not authoritative.** CPS-16's list omits `//connect`, which CIP-45 has used since 2023. Grep the repo before claiming a name is free.

### Grammar and unit rules, learned the hard way

Every rule below was paid for by a bug that shipped. Sources: issue #836 and the CIP-157 review thread (PR 843).

- **Never put a variable directly after `//`.** What follows `//` is the URI *authority* and must be a fixed token. Yoroi shipped `web+cardano:<addr>`, VESPR shipped `web+cardano://<addr>`; the second violates RFC 3986 and breaks standard parsers. Consensus, January 2026: the legacy authority-less form stays for the original payment shape, everything new uses `//<authority>`.
- **Version in the path from the first release.** CIP-158 ships `web+cardano://browse/v1?uri=<percent-encoded>` — fixed authority token, `/v1` segment, query payload. That is the shape `//slip` follows (ADR-0007), which makes our registration a conformance argument rather than a proposal.
- **Percent-encode anything carried as a value.** `|` is not URI-safe and had to be pulled from CIP-157's asset syntax; the usable sub-delims are `- . _ ~ ! $ ( ) * + ;`.
- **Quantities are integer base units, never decimals-adjusted.** Mishandled decimals on `amount` is the most repeated bug in the whole family — it shipped in Eternl and Begin — and VESPR asked CIP-157 to state it normatively. Display decimals travel separately and are never authoritative. Spec input on #17, adversarial case on #41.
- **Identify assets as `<policy_id>.<asset_name>`, not by fingerprint.** Fingerprints are fixed-length and would give predictable URI lengths, but neither Blockfrost nor Koios can query by them. Short tickers are worse: they collide with each other and with query keywords — a token named `MSG` breaks `&msg=`.

### Why this layer stalls

The URI family's problem is adoption, not design. Wallet teams largely do not engage with the CIP process; each ships its own shape first, and editors have spent two years asking for a working group that has not convened. The record:

| When | What |
|---|---|
| 2020 → now | CIP-13 is still `Status: Proposed`, `Implementors: N/A` |
| 2024-06 → now | CIP-157 `//pay` open as PR 843, stalled on how to name an asset in a URI; VESPR de-prioritised it |
| 2025-12 | "I can not find a single mobile wallet that has implemented CIP13 payment links correctly" |
| 2026-02 | Yoroi found shipping the pre-merge, faulty form of CIP-158 |
| 2026-05 | PR 842 `//authentication` closed by editors after two years without a specification |
| 2026-07 | The scheme's advocate leaves Cardano; the wallet-support tracker goes unmaintained |

Two things follow, and both are already decisions rather than observations. **M1 must not need a wallet to change** — desktop web, CIP-30 and ordinary `https://` links ask nothing of any URI handler, which is why ADR-0007 keeps `//slip` on the roadmap. And **our Path to Active must not name wallet adoption of an authority as a criterion** (#21), because that is precisely the criterion that has held CIP-13 for six years. Where we do use an authority — `//browse` for mobile entry — it gets verified per wallet rather than assumed (#98).

## 2. CIP-99 — the precedent that matters most

Status **Active**, the only CIP-13 extension to reach it, with five wallet implementors: VESPR, Yoroi, Lace, Begin, Eternl Mobile.

It is already a URI → wallet → HTTP POST to a third-party server → structured JSON response protocol. The wallet posts `{ address, code }` to a `faucet_url` carried in the URI. Ours posts `{ changeAddress, network }`. The shape is not novel and the ecosystem has already accepted it.

**What CIP-99 does not do is return a transaction the user signs.** Its server builds and submits the transaction itself and pays for it; the user receives tokens and never signs anything. That is the honest statement of what we add, and it is stronger than an argument from absence:

> Wallets will POST to a project's own server from a URI — CIP-99 is Active with five implementations. What no authority does is return a transaction for the user to authorise. Every one that produces a transaction either fixes its shape in the URI or has the server sign it.

**It is also the template for getting to Active.** CIP-99 shipped with an open-source reference server, a wallet vendor among its authors, and a concrete use case. CIP-157 has none of those and has sat open since June 2024. We have the reference server (`server` plus the AdaLink integration) and the use case. The missing ingredient is a wallet co-author.

## 3. CIP-186 — the mobile transport, and why it is not ours

Merged 2026-08-04 as Proposed. A CIP-30 transport over OS deep links: `connect`, `signTx`, `signData`, X25519 pairing, a BLAKE2b-256 commit over the canonical tx body, witness set returned via a universal-link callback. Eternl, Gero and Yuti have independently converged implementations.

**It cannot carry the slip page, and we should not claim it does.** Its source-app identity binding is normative and assumes a native app: on iOS the wallet must find an `applinks` entry in the redirect host's `apple-app-site-association` and display the bundle ID, and on Android it must match `getCallingPackage()` against `assetlinks.json`. Failure is `errorCode=-13 SourceAppUnverified` before the signing screen renders. A web page has neither a bundle ID nor a package. Serving an AASA for an app we don't ship would forge the exact attestation the check exists to make.

**What it does confirm is our mobile path.** CIP-186's *In-process WebView dApps* clause states that a dApp inside a wallet's WebView "is NOT a deep-link dApp — it already has `window.cardano` injected per CIP-30 and MUST use that interface instead," and requires wallets to refuse the deep link there. Our `//browse` → wallet in-app browser → injected CIP-30 route is the path CIP-186 points at, not a workaround competing with it.

**What we take from it.** Three wallet teams reviewed these decisions for free:

| Take | Why |
|---|---|
| Commit binding: `BLAKE2b-256(canonical-cbor(tx_body))`, echoed in the response and re-checked by the client | Binds a returned witness set to the exact body we derived effects from. Matters most on rebuild-and-retry, where a body changes mid-flow |
| Witness merge is append, never replace, on `vkey_witnesses`; reject responses carrying non-vkey material we did not expect | Replace semantics silently drops co-signers; unexpected script material is injection |
| Strict base64url decode — reject padding and non-canonical tails | Permissive decoders admit malleability |
| Wallets return no UTxOs; addresses capped | Our Mode A privacy stance, already normative in a merged CIP rather than asserted only by us |

Its test vectors under `CIP-0186/tests/vectors/` cover Conway tx body extraction, commit computation and witness splicing — behaviours `verifier` and `flow` must get right whatever the transport. Reuse them as fixtures rather than deriving our own oracle.

**Do not overstate its maturity.** `Implementors:` is empty, the reference SDK it names is not published, and its acceptance criteria are unchecked. It is "merged, with three converging implementations" — not "shipping".

## 4. CIP-170 — identity

KERI-backed attestations, anchoring a digest of arbitrary data in an issuer's Key Event Log and referencing it in transaction metadata under label `170`. Cardano Foundation authors; Reeve and Veridian as implementors.

It defines no publisher payload and no domain→identifier discovery, and its own text calls watcher-network deployment immature. That is why identity ships in two tiers — see ADR-0006.

Its acceptance criteria are unchecked, and criterion 2 names "identity-bound actions" as a qualifying use. Being the implementation that satisfies it is worth raising with the authors directly.

## 5. CPS-10 — wallet connectors

The open problem statement CIP-186 answers: CIP-30 is a JavaScript injection contract over a shared browser window, which excludes non-web wallets and non-JS stacks. Relevant context for why the mobile story is shaped the way it is. We are not proposing a solution to it.

## 6. People

The URI space is small and the same names recur. Engage before submitting, not after.

- **rphair** — CIP editor, the ecosystem's most persistent URI advocate. Puts URI items on the biweekly editors' agenda (`hackmd.io/@cip-editors`), and has said publicly he will stay on issue #836 for as long as he is in Cardano.
- **Adam Dean (Crypto2099)** — author of CIP-13's extensions, CIP-99, CIP-157, CIP-158, and CPS-16. Asked publicly at Buidler Fest for help with QR codes carrying a whole contract.
- **Alex Dochioiu** — VESPR; co-author of CIP-99, and the one who de-prioritised CIP-157.
- **realdecimalist** — CIP-186.
- **marcuspuchalla** — Eternl; built the first CIP-186 implementation and reviewed the spec against it.
- **Mad Orkestra** — opened issue #836 and authored CIP-162 `//drep`; built the wallet-support tracker. Stopped working on Cardano in July 2026.

On 2026-02-18 editors resolved to find a co-author advocate for the stalled URI CIPs and to assemble a GitHub tag list of wallet representatives; the person they asked has since left. That list, once it exists, is the shortest route to the wallet co-author §2 says this CIP still needs.

The CIP-13 wallet support tracker at `cip13.cardanothings.io` is useful but unmaintained: a single-page SvelteKit site, last modified 2026-05-19, whose author left Cardano in July 2026. Do not cite it as live evidence of what a wallet supports today — test the wallet.
