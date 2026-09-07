# Cardano Slips

Turn a shareable link into a signable Cardano transaction. Share a link on X, WhatsApp, or a printed QR code — the recipient reviews the transaction's effects and confirms in their own wallet. Open spec + TypeScript SDK.

> Developed in the open — the specification, the SDK, and the reasoning behind both. Track what is moving in [issues](https://github.com/emmanuel-musau/cardano-slips/issues).

## Why it's different

Solana established the format with Actions and Blinks. Cardano's eUTxO model lets a client **derive** exact value movements, fees, certificates, and expiry from the transaction body, resolved inputs, the user's addresses, and protocol parameters. The client then **blocks signing** if those effects contradict the endpoint's declared transaction intent. Titles, descriptions, and messages are publisher-written text; the verifier does not check their meaning.

The effects check applies to every publisher, so the protocol needs no registry of approved endpoints. Publisher identity is a separate check and never relaxes the signing block.

## How it works

1. A dApp hosts a **Slip** endpoint. `GET` describes the intent (title, icon, parameters); `POST` returns a *partial* transaction covering only the dApp's side.
2. Anyone shares the **link**. `slips.json` lets a human URL front a technical endpoint.
3. A **client** — the slip page, a wallet, a bot — resolves the link, balances the transaction locally against the user's own UTxOs (the endpoint never sees them), derives the exact effects, shows them, and hands off to the wallet over CIP-30.

Holds no user funds. No custody, no relayer, no treasury validator. The client checks effects before requesting a signature; the user's wallet signs and submits the transaction.

## Packages

| Package | What it does |
|---|---|
| `@cardano-slips/core` | the shared contract — schemas, URL rules, error codes |
| `@cardano-slips/server` | publish a Slip endpoint — `defineSlip()` + Next.js adapter |
| `@cardano-slips/verifier` | derive what the transaction really does, and block signing if the metadata lies |
| `@cardano-slips/flow` | run the user through it — Slip UI + CIP-30 wallet orchestration |

Plus `apps/page` (hosted, self-hostable fallback page) and `examples/adalink` (reference integration: USDM/USDCx payment Slips).

## Documentation

| Document | Read it for |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | product scope, protocol contract, security model, delivery scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | package layout, dependency rules, data flows, trust model |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | board process, branching, commits, definition of done |
| [docs/DECISIONS/](docs/DECISIONS/) | architecture decision records |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Cardano and protocol terms as used here |
| [CONTRIBUTING.md](CONTRIBUTING.md) | setup, branch and PR conventions, the testing bar, changesets |
| [SECURITY.md](SECURITY.md) | what counts as a vulnerability here, and how to report one privately |
| [spec/](spec/) | the CIP: request and response shapes, error codes, resolution rules |

## Built on

The M1 design uses [`@evolution-sdk/evolution`](https://github.com/IntersectMBO/evolution-sdk) for transaction construction, ordinary HTTPS links for routing, and CIP-30 for wallet signing. On mobile, CIP-158 `//browse` opens the slip page inside a compatible wallet's browser. A `.well-known` publisher manifest provides domain attestation; the higher-assurance CIP-0170 tier is subject to a separate go/no-go decision. The proposed CIP-13 `//slip` authority is deferred beyond M1. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for scope.

## Standardisation

The specification is submitted to `cardano-foundation/CIPs` after the implementation runs on mainnet, so the standard belongs to the ecosystem rather than to this repository.

## License

MIT — see [LICENSE](LICENSE).
