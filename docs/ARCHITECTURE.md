# Architecture

How the pieces fit, what each package owns, and the dependency rules that keep the security model intact.

## Repository layout

```
cardano-slips/
├── .github/
│   ├── workflows/ci.yml       lint, typecheck, test, build on every PR
│   ├── workflows/release.yml  Changesets → version PR, then npm on merge
│   ├── ISSUE_TEMPLATE/        bug, feature, spec-change
│   ├── PULL_REQUEST_TEMPLATE/ opt-in; default.md is the definition of done
│   └── CODEOWNERS             spec/ and packages/verifier/ route to the tech lead
├── spec/
│   ├── CIP-XXXX/
│   │   ├── README.md          the CIP: //slip authority, GET/POST shapes,
│   │   │                      partial-intent format, error codes
│   │   └── schemas/           JSON Schema for every payload, consumed by core
│   └── examples/              the request/response pairs the spec is written from
├── packages/
│   ├── core/                  types, URL resolution, slips.json, validation
│   ├── verifier/              CBOR decode → deltas. The security engine.
│   ├── server/                defineSlip() + Next.js adapter
│   ├── identity/              publisher attestation: domain manifest + CIP-0170
│   └── flow/                  React components + CIP-30 orchestration
├── apps/
│   ├── page/                  the slip page, hosted + self-hostable
│   └── docs/                  docs site + the Slip tester
├── examples/
│   ├── slips/                 the delegate and tip fixtures, shared by tests and docs
│   └── adalink/               reference integration: USDM/USDCx payment Slip
├── docs/                      requirements, architecture, workflow, ADRs
├── .changeset/
├── pnpm-workspace.yaml        packages/*, apps/*, examples/*
├── turbo.json                 task graph + caching, inter-package ordering
├── tsconfig.base.json         strict ESM, NodeNext — every package extends this
├── eslint.config.js           ESLint flat config + Prettier
├── vitest.config.ts           whole suite from root; each package keeps its config
├── tsconfig.test.json         shared test compiler options
├── CONTRIBUTING.md            setup, PR flow, the testing bar, changesets
├── SECURITY.md                private reporting, scope, disclosure timeline
└── LICENSE                    MIT
```

Deferred to roadmap, **not** built in M1: `packages/deeplink` (CIP-13 `//slip`), `apps/extension` (inline renderer).

## Package responsibilities

### `core`
Shared vocabulary. Effect Schema definitions for the GET metadata response and the partial-intent POST response; `slips.json` fetch + pathPattern resolution; parameter template interpolation (`{amount}`). Depends on nothing else in the workspace. Both `server` (produce) and `flow` (consume) validate against these schemas, which makes the schema the executable form of the spec.

| Module | Owns |
|---|---|
| `types.ts` | `Slip`, `Parameter`, `PartialIntent`, `DerivedEffects` — what a third-party implementer reads first |
| `build-request.ts` | The body a client `POST`s — `changeAddress` and `network`, closed to anything else. The member that rejects a UTxO set is where Mode A's privacy actually lives. |
| `url.ts` | Parse, resolve, validate Slip URLs; the human URL → technical endpoint indirection |
| `slips-json.ts` | Domain mapping rules, so `linktap.example/pay/corner-store` resolves to `/api/slips/pay` |
| `errors.ts` | The typed error codes — every failure mode the UI must render has a code here |

Zero runtime dependencies is the goal.

### `server`
`defineSlip({ get, post })` — typed handlers whose output is validated against `core` schemas *before it leaves the server*, so a misconfigured dApp fails at its own boundary rather than at the user's wallet. Two framework adapters in M1: route handlers, CORS headers, `slips.json` serving, spec error codes mapped to HTTP status. A Web-standard runtime — Next.js App Router, Hono, SvelteKit, Bun, Workers — needs no adapter at all, because `defineSlip` already returns `(Request) => Promise<Response>`; what ships for Next is the `slips.json` helper, dynamic-segment params and the integration guide. Node's `IncomingMessage`/`ServerResponse` frameworks do need a bridge, and AdaLink serves its endpoints from NestJS, so that adapter is M1 rather than deferred. Fastify and Hono-specific bindings stay deferred. An endpoint that is not TypeScript at all — AdaLink's Laravel side — conforms against the normative JSON Schemas in `spec/CIP-XXXX/schemas/` rather than this package, and that it can is the protocol working as intended.

| Module | Owns |
|---|---|
| `define-slip.ts` | The core helper: `get` + `post` handlers → validated, spec-compliant endpoint with CORS and error handling built in. The network is declared once beside them, which is what lets a `POST` check the three statements of network the spec requires to agree. |
| `domain-mapping.ts` | `defineDomainMapping({ rules })` → the `slips.json` handlers. Framework-neutral, so every Web-standard runtime gets it without an adapter. |
| `adapters/node.ts` | The `IncomingMessage`/`ServerResponse` bridge for NestJS and Express. Takes the origin explicitly: `context.url` reaches the publisher's handlers and feeds the same-origin check in `checkTemplates`, and a spoofed `Host` corrupts both. |

The whole developer-experience promise — a Slip in about twenty lines — is this package's job.

### `verifier` — the security engine
Decodes balanced transaction CBOR and derives, independently of anything the endpoint claimed:

| Derived | Rendered as |
|---|---|
| net ADA delta for user addresses, exact fee, deposits | "You pay 0.17 ADA (fee)", "Deposit 2.00 ADA (refundable)" |
| net asset deltas per policy/asset | "You receive 25 USDM" |
| certificates | "Delegate → pool1xyz" |
| withdrawals | "Withdraws N ADA rewards" |
| mint/burn | assets created/destroyed |
| validity interval | "Expires in 4m 12s" |

Then compares derived effects against what the endpoint declared in the partial intent and returns `match | mismatch(reasons[])`. Undeclared effects — an extra output, an unexpected certificate — are always a mismatch. The rules and the reason vocabulary are normative: see [The comparison](../spec/CIP-XXXX/README.md#the-comparison), whose published table of verdicts `compare.ts` runs as conformance vectors.

**Two of the five terms are easy to miss, and both were found late.** A net ADA delta needs the value of the inputs being spent, and a transaction body carries only references to them — so **resolved inputs** are an argument (ADR-0010). A fee ceiling, the raise of an output to the ledger minimum, a deposit told apart from a spend, and a validity interval shown as wall-clock time all need **protocol parameters** — the minimum-fee coefficients, the per-byte cost, the stake deposit and its refund, and the slot-to-time mapping. In Mode A the client holds all of it before it starts. Anything the engine had to fetch would put a network call between a person and a signature.

**This package is a pure function of (tx CBOR, declared metadata, user addresses, resolved inputs, protocol parameters).** It performs no I/O and imports nothing from `flow`, `server`, or any network layer. That purity is what makes the attack examples a meaningful proof: they exercise the exact code path that runs before a real signature. If the engine had side effects or network calls, "we blocked 100% of lying transactions" would be a claim about a system rather than a property of a function.

| Module | Owns |
|---|---|
| `decode.ts` | CBOR → structured transaction. Where the edge cases live; budget accordingly. |
| `derive.ts` | Diffs inputs against outputs for the user's addresses → ADA delta, per-policy asset deltas, exact fee, certificates, withdrawals, mint/burn, validity interval. Takes four of the five terms — the declared metadata is the comparison's business, not the arithmetic's. |
| `deposits.ts` | Separates refundable deposits (stake registration's 2 ADA) from spent value. Showing a deposit as a cost is wrong; hiding it is worse. |
| `parameters.ts` | The protocol parameters the engine is handed rather than fetches. The deposits and the slot-to-time mapping so far; the minimum-fee coefficients and the per-byte cost arrive with the tickets that need them. |
| `compare.ts` | Derived vs declared → verdict. This function is what blocks a signature. |
| `test/fixtures/` | ~50 known-good mainnet transactions with expected outputs. Regression safety. Every fixture's derived commit must equal its known transaction id, and each fixture carries the chain's own reading of what the transaction does, recorded when it was collected, as the second opinion (ADR-0010, ADR-0012). CIP-0186's two published CBOR vectors are included as conformance checks on tx-body extraction and commit computation — they are shape tests over minimal bodies, not real transactions, so they pin the rule but do not stand in for the fixtures. |
| `test/attacks/` | **The proof.** Transactions whose declared metadata contradicts what they do — hidden outputs, wrong pool, inflated fee, unexpected mint. Public, and the strongest single piece of evidence that the security claim holds. |

Deliberately consumable standalone: a wallet or an explorer should be able to use `verifier` without adopting the rest of the protocol. That reusability is an argument in the CIP.

### `identity`
Publisher attestation: issue and resolve, in two tiers (REQUIREMENTS §5).

| Tier | Mechanism | What the client renders |
|---|---|---|
| 1 | Signed manifest at `https://<domain>/.well-known/cardano-slips.json`, binding the domain to the endpoints it vouches for. No chain write. | published by `<domain>`, domain-verified |
| 2 | CIP-0170 KERI `ATTEST` — digest of the Tier-1 manifest anchored in the issuer's KEL, referenced in tx metadata label `170`, chained to a vLEI-grade entity via `signify-ts` | published by `<legal entity>`, identity-verified |

Tier 2 sits on top of Tier 1 rather than beside it: the manifest is the payload being attested, and Tier 1 is also what supplies domain→AID discovery, which CIP-0170 does not define. The manifest shape follows CIP-0186's origin-anchored `.well-known/cip30dl-attestation.json` precedent — same trust anchor, same 24h cache posture — so a wallet team reading both sees one pattern.

Resolution is read-only and cacheable; issuance is a publisher-side operation and never runs in the browser path. Every resolve outcome — absent, malformed, expired, revoked, valid — is a distinct rendered state, and only the last one says verified. There is no code path in which a failed resolve degrades into a verified badge.

**Why it is its own package.** Tier 2 is the piece most likely to be cut at the Month 1 go/no-go — it is pre-production, new to the team, and its verification path depends on KEL availability the CIP itself calls immature. As a separate package, cutting it means deleting a dependency line; folded into `flow`, it means untangling code under time pressure. This split is a scope-risk hedge, not an architectural preference — and it is why the tiers are separable at all.

### `flow`
CIP-30 orchestration plus React components. Wallet discovery/enable, change address + network id, local balancing via `@evolution-sdk/evolution` against the user's own UTxOs, effects derivation, `signTx` → witness assembly → `submitTx`, and rebuild-and-retry when UTxOs move mid-flow. Components: Slip card, generated parameter form, effects panel with the mismatch block, publisher chip, wallet selector, receipt, error states. Hooks (`useSlip`, `useWallet`, `useEffects`) are the composable surface.

`tokens.css` holds the design tokens as CSS custom properties and is the single source of truth — no hard-coded hex anywhere in components.

Must survive being dropped into a third-party page: no fixed positioning, no assumption it owns the page, self-contained styles that tolerate an inherited font stack.

### `apps/page`
Tier-1 client and the M1 headline: a hosted, self-hostable page that runs the whole flow with zero wallet cooperation beyond CIP-30. Also owns OG/Twitter preview metadata, since the unfurl is the first impression of a shared link.

### `apps/docs`
Documentation site and the Slip tester — paste an endpoint URL, see the rendered card alongside the raw GET/POST payloads. The tester is the single best adoption tool in the project: a developer verifies their endpoint in seconds without installing anything.

### `examples/slips`
The delegate Slip (a certificate intent, nothing spent but the fee) and the tip Slip (one output whose amount the person picks through a parameterised linked action), both defined with `defineSlip`. Private to the workspace: the server tests, the client tests and the docs site read the same two fixtures rather than each keeping a copy that drifts. `test/publishing.test.ts` is what keeps everything under `examples/` off the registry.

The server's end-to-end tests live here too, beside the fixtures rather than in `packages/server/test`. They need both the fixtures and `server`, and this package already depends on `server` — so pointing `server` back at it would be a cycle, and the rule that apps and examples depend on packages and never the reverse is what forbids it. What they drive is an App Router tree's routing over the handlers `defineSlip` returns.

### `examples/adalink`
Reference integration, not a library. Proves the SDK on a product with real users: USDM/USDCx payment Slips, human URLs via `slips.json`, live on mainnet with labelled transactions. It runs NestJS behind Laravel/Inertia, which is why the Node adapter is M1 work and not deferred.

## Dependency rules

```
core  ←  server
  ↑
  └───  flow  →  verifier
         │  ↓
         │  evolution-sdk
         └→ identity

      page          →  (flow, core)
      docs          →  (flow, core)
      slips         →  (server, core)
      adalink       →  (server, via the Node adapter)
```

- `core` depends on no workspace package.
- `verifier` depends on `core` types only — never on `flow`/`server`.
- `server` never imports `flow` or `verifier`; a dApp shipping an endpoint should not pull a React tree.
- `identity` is a leaf that `flow` consumes; nothing depends on `identity` in reverse.
- Apps depend on packages, never the reverse.

Enforce the direction in review. The moment `verifier` imports from `flow`, the security argument gets harder to make.

## TypeScript configuration

`tsconfig.base.json` at the root holds compiler options and nothing else — no `include`, no `files`. It is strict, `ES2022`, `NodeNext` for both `module` and `moduleResolution`, and emits declarations with maps. Every package extends it; no package restates a compiler option that belongs in the base.

Root `tsconfig.json` is a solution file: `include: []` plus one reference per package, so `tsc --build` at the root walks the workspace in dependency order. Add the reference when the package lands.

Each package carries the same four files, mirroring evolution-sdk, plus one editor shim:

| File | Role |
|---|---|
| `tsconfig.json` | solution file for the package — `include: []`, references `tsconfig.src.json` |
| `tsconfig.src.json` | the sources: `include: ["src"]`, `rootDir: "src"`, `outDir: "build/src"`, own `tsBuildInfoFile` |
| `tsconfig.build.json` | extends `tsconfig.src.json`, adds `outDir: "dist"` and `stripInternal` — what `pnpm build` runs, and the only config that writes `dist` |
| `tsconfig.test.json` | extends the **root** `tsconfig.test.json`, `include`s the tests, references `tsconfig.src.json` |
| `test/tsconfig.json` | editor shim. A referenced project must be composite and a composite project must emit, so `tsconfig.test.json` cannot hang off the solution file — tsserver then finds no project for a test file and falls back to defaults without `@types/node`. This is where tsserver looks first. `pnpm typecheck` still runs the config above. |

```jsonc
// packages/core/tsconfig.src.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "build/src",
    "tsBuildInfoFile": ".tsbuildinfo/src.tsbuildinfo"
  }
}
```

`tsconfig.src.json` emits to `build/src`, not to `dist`. Both configs have to emit — a composite project cannot typecheck without writing its declarations — and if the typecheck wrote `dist` it would overwrite, without `stripInternal`, the directory turbo has already cached as the `build` output. Two directories, one of them published.

That split is also why a package typechecks in two commands rather than one: `tsc -b tsconfig.src.json && tsc -p tsconfig.test.json`. `tsc -b` refuses to walk a non-composite reference, and the root test config turns `composite` off — so the tests are typechecked with `-p`, resolving `../src/index.js` through the declarations the first command just emitted.

Two consequences worth internalising before the first package is written:

- **Declaration output is the linkage.** `flow` typechecks against `core`'s emitted `.d.ts`, not its sources. That is why the turbo `typecheck` and `test` tasks depend on `^build` — skip the build and the import is simply unresolvable.
- **Relative imports carry explicit file extensions** (`./util.js`, pointing at the emitted file, from `util.ts`). NodeNext rejects the extensionless form outright; this is the ESM strictness tax ADR-0003 accepts.

`types: []` in the base keeps ambient globals out. A package that needs Node globals opts in with `"types": ["node"]` in its own config, which keeps `core` honest about its zero-dependency goal.

## Dependency versions

**Every dependency tracks latest.** ADR-0003 says mirror the evolution-sdk *toolchain* — the same tools, not the same version pins. Upstream lags, and inheriting its lag means inheriting bugs that are already fixed. Check `npm view <pkg> version` before adding anything, and take the current release.

One exception is live, and it is not a preference:

| Package | Held at | Why |
|---|---|---|
| `typescript` | `^6.0.3` | `typescript-eslint` declares `typescript >=4.8.4 <6.1.0`. No release of it — not even canary — supports TypeScript 7, the native port. Moving to 7 means giving up TypeScript linting entirely. |

Revisit the moment `typescript-eslint` widens that peer range. Anything else falling behind is a bug, not a decision.

## Lint and format

One flat config at the root — `eslint.config.js` — governs the whole workspace. Packages do not carry their own ESLint config; they carry a `"lint": "eslint ."` script so the turbo `lint` task can run and cache them per package. ESLint judges correctness only: `eslint-config-prettier` is applied last and switches off every rule that Prettier already decides, so the two tools never disagree about a line.

| Command | Does |
|---|---|
| `pnpm lint` | `turbo run lint` — each package's ESLint pass, cached |
| `pnpm lint:fix` | the same with `--fix` |
| `pnpm format` | Prettier writes across the repo |
| `pnpm format:check` | Prettier verifies without writing — the CI gate |

Prettier settings mirror evolution-sdk: no semicolons, double quotes, no trailing comma, 120 columns. Markdown is in `.prettierignore` on purpose — `docs/` and `spec/` are written by hand, and a reflowed table buries the actual edit in a review.

Two rules carry more weight than the rest:

- **`no-console` is an error.** Library code returns typed errors; it does not print. User-facing failures go through the spec error codes with human-readable messages, which is a `flow` / slip page concern, not a stray log line in `verifier`.
- **`@typescript-eslint/no-unused-vars` respects a `_` prefix**, so a deliberately discarded binding says so in its name.

Type-aware linting (`recommendedTypeChecked`, which is what catches floating promises) is not enabled yet — it needs real packages with `tsconfig.src.json` inputs to point at. Worth turning on once `core` exists.

## Test runner

Vitest 4 dropped `vitest.workspace.ts`; the workspace now lives in root `vitest.config.ts` under `test.projects`, globbing `packages/*` and `apps/*`. A package's own `vitest.config.ts` overrides whatever it sets — `flow` will want `jsdom`, `verifier` will want longer timeouts — and the root file owns only what is genuinely shared: coverage settings and `globals: false`.

`globals: false` is deliberate. The base tsconfig ships `types: []`, and a test that imports `describe`/`it`/`expect` by name reads without ambient magic.

| Command | Does |
|---|---|
| `pnpm test` | `turbo run test` — each package's suite, cached. The CI gate. |
| `pnpm test:watch` | `vitest` from the root across every project |
| `pnpm coverage` | the same suites with v8 coverage |

Test sources are typechecked but never emitted, so root `tsconfig.test.json` turns `composite`/`declaration` back off and adds `types: ["node"]`. Only tests get Node globals: `src/` stays on `types: []`, so a `process.env` read inside `core` is a compile error rather than a silent runtime dependency.

**`passWithNoTests` is not set, anywhere.** A package that declares a `test` script and ships no test files fails its run — which is the intended outcome in a repo where code without tests is not finished work. Today `pnpm test` passes because there are no packages yet, not because empty suites are tolerated.

## The two data flows

**Build (Mode A, the only v1 mode).** Client resolves the link through `slips.json` → `GET` metadata → renders card → wallet connect → `POST { changeAddress, network }` → server returns a *partial* intent (its side only) → **client balances locally** → complete unsigned tx. The endpoint never sees the user's UTxO set; that is the privacy advantage we extracted from the eUTxO input-selection constraint.

**Sign.** Derive effects → compare → block on mismatch, otherwise show exact effects → `signTx` (returns a **witness set**, not a signed tx) → assemble witnesses into the body → `submitTx` → receipt. On input-spent failure, rebuild from fresh UTxOs, re-derive effects, and only then re-prompt.

`flow` holds a **commit** — `BLAKE2b-256(canonical-cbor(tx_body))`, which is the transaction id — for the body effects were derived from, and assembles witnesses only into that body. A rebuild yields a new commit and re-derivation. Witnesses append to `vkey_witnesses`, never replace, and a witness set carrying non-vkey material we did not expect is rejected rather than merged. Both rules come from CIP-186, which three wallet teams have implemented; adopting them costs nothing and keeps our vocabulary aligned with the transport a native mobile client would use. Invisible to endpoint authors.

## Trust model

Two halves of one answer, and neither is sufficient alone:

- **Effects derivation** proves *what* the transaction does. Arithmetic on the tx body, not a simulation — possible because eUTxO transactions fully determine their own effects. Mismatch hard-blocks signing.
- **Publisher attestation** proves *who* is asking — a domain manifest by default, a CIP-0170 KERI credential chain where legal identity matters. Resolved and verified client-side, rendered beside the effects. Unverified publishers are marked, not blocked — identity augments, effects gate.

Effects without identity leaves users approving correct transactions from unknown parties. Identity without effects is the central registry Solana needed and we are avoiding.

## Conventions a reviewer enforces

- **No hard-coded colours outside `tokens.css`.** Lint-enforced where possible.
- **`verifier` stays pure.** No network calls, no React imports, no wallet references. Ever.
- **The set of attack examples grows with every bug.** Any transaction that should have been blocked and wasn't becomes a permanent test case.
- **Spec changes are PRs against `spec/` first**, implementation second. The schemas are the contract.
- **Every package publishes independently** via Changesets. A fix in `verifier` must not force a `flow` release.

## Deliberate non-architecture

No treasury validator, no relayer, no fee tank, no custody, no central registry, no service we operate that the protocol depends on. dApps host their own endpoints; the slip page is self-hostable; the SDK is a library. The blast radius of a bug here is a failed transaction, not a drained wallet.
