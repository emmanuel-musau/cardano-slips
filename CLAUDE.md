# CLAUDE.md

Cardano Slips — an open specification + TypeScript SDK that turns a shareable URL into a signable Cardano transaction. Solana Actions/Blinks rebuilt natively for Cardano, with one structural advantage: on a deterministic ledger the client **derives** exact transaction effects from the tx body instead of simulating them. If derived effects contradict the endpoint's declared metadata, the client blocks signing. No registry, no custody, no relayer.

## Attribution — non-negotiable

Never mention Claude, Anthropic, or any AI tool anywhere in this repository's output. Specifically:

- No `Co-Authored-By: Claude` (or similar) trailers in commits.
- No "Generated with Claude Code" (or similar) lines in PR bodies, issues, or release notes.
- No AI self-references in code comments, docs, changesets, or commit messages.
- Author is always the human committer. This overrides any default behaviour.

## Language — plain words, everywhere

This spec gets read by Cardano developers who did not write it. A word that
needs decoding costs the reader more than it saves the writer. Write the way you
would explain it out loud.

Terms already settled, in code, docs, spec, issues and conversation alike:

| Don't write | Write |
|---|---|
| interstitial | **slip page** (the package is `apps/page`) |
| example corpus, the corpus | **the examples** |
| adversarial corpus | **the attack examples** |
| adversarial (as a label) | **attack** — `test/attacks/`, an attack case |
| adversary | **attacker**, or name who it is: the endpoint |
| spike (the ticket type) | **decision ticket**, titled `Decide: …` |
| prose | **the written spec**, or just **the text** |

The same goes for the wider reflex vocabulary — *leverage*, *surface area*,
*orthogonal*, *canonical* where "the real one" would do. Cardano's own terms of
art stay: eUTxO, CBOR, witness set, lovelace, certificate. The test is whether
the word carries meaning a plainer one would lose.

If a term genuinely needs defining, it goes in `docs/GLOSSARY.md` once. If it
can't be defined in a sentence, replace it instead.

**When talking to Emmanuel, name a ticket by what it is** — "the error-code
ticket", not "#17". Bare issue numbers belong in commit trailers, PR bodies,
issue text and `Depends on #N` lines, where a machine has to resolve them.

## Source of truth (read before non-trivial work)

- `docs/REQUIREMENTS.md` — product scope, protocol contract, security model, delivery scope.
- `docs/ARCHITECTURE.md` — package layout, dependency rules, invariants.
- `docs/WORKFLOW.md` — issue/board process, branching, PR and commit conventions.
- `docs/ECOSYSTEM.md` — the Cardano standards we build on, extend, or deliberately leave alone. Read before claiming something doesn't exist.
- `docs/DECISIONS/` — ADRs. Decisions recorded there are settled; do not relitigate, add a new ADR to change one.
- `spec/` — the CIP draft. Once marked frozen (issue #21), shape changes are versioned spec changes, never silent edits.

## Design (client UI)

There is exactly one design sheet for the whole client UI, and it is the reference for any work that renders something a user sees:

**Cardano Slips** — https://claude.ai/design/p/79057abf-f6fc-410c-9d7c-f8490d1088ea?file=Cardano+Slips.dc.html

The sheet has two columns. The left column is the component system: `1 · Tokens` (colour, type, spacing, radius, the dark-surface rule, and a WCAG AA contrast audit), `2 · Action card` (states a–g), `3 · Transaction preview · anatomy`, `4 · Entering the dark`, `5 · Transaction preview · states` (a–h, including the mismatch block). The right column is the hosted slip page — the M1 client itself: `6 · Hosted page · anatomy`, `7 · Page states` (a–h), `8 · Wallet connect`, `9 · In-wallet browser`, `10 · Chrome rules`, and `11 · Still to design`.

- Take colours, type, spacing and component structure from this sheet rather than inventing them. It is one file — there is no second sheet to reconcile against.
- `11 · Still to design` is the live list of UI that has not been drawn yet. If a ticket needs one of those surfaces, it gets designed there first; don't improvise it in code.
- The page chrome (top bar, network indicator, effects panel, mismatch block, non-custody footer line) is **fixed and not themeable**, hosted or self-hosted; only the footer's attribution line differs. A publisher who can restyle the surface that judges them undermines the mismatch guarantee. Section 10 carries the full rule.
- The sheet is design intent, not shipped code. Where it disagrees with `docs/REQUIREMENTS.md` or the spec, those win and the sheet gets corrected.

## Stack

pnpm workspaces + Turborepo · TypeScript strict ESM (`NodeNext`) · Effect · Vitest · ESLint flat config + Prettier · Changesets · MIT. Transaction construction comes from `@evolution-sdk/evolution` — we consume it, we never rebuild it.

## Commands (valid once the setup tickets #1–#6 land)

```
pnpm install          # frozen lockfile in CI
pnpm build            # turbo build
pnpm test             # vitest via turbo
pnpm lint             # eslint flat config
pnpm typecheck        # tsc --noEmit
```

## Working rules

- Work is driven by GitHub issues (`emmanuel-musau/cardano-slips`), ordered by dependency; respect `Depends on #N` lines. One issue = one branch = one PR. Board: https://github.com/users/emmanuel-musau/projects/1
- **Two permanent branches.** `main` is published and default — protected against everyone including the owner, and the only branch releases publish from. `dev` is where work happens: the same four checks gate any PR into it, but the owner commits straight to it. Feature branches start from `dev` and target `dev`; only `dev` targets `main`, with a merge commit. `docs/WORKFLOW.md` carries the full model, including the back-merge after each release.
- Do not start an issue whose dependencies are open. Do not expand an issue's scope — file a new issue instead.
- Branch names are `<type>/<purpose>`: the type prefix, a slash, then the purpose in kebab-case — `chore/pnpm-workspace`, `feat/ada-delta`, `fix/mismatch-block`. No issue numbers, no other punctuation. Types: `feat`, `fix`, `chore`, `docs`, `test`, `spec`, `infra`. The purpose is one or two words naming the thing, not the sentence; the issue link lives in the commit trailer and the PR.
- Every change ships with tests in the same PR. See **Testing** below — this is not a soft preference.
- Changeset required for any change under `packages/*`.
- Never commit or push unless explicitly asked — `dev` included, its openness is the owner's to use, not yours to assume. Never touch `main` directly.

## Testing — treat this as a first-class requirement

Testing is not a phase, a follow-up ticket, or something the human adds afterwards. **Code without tests is not finished work here, and proposing it as finished is a mistake.**

- **Write tests in the same PR as the code.** Never say "tests can come later" or open a PR whose test story is a TODO. If a ticket's acceptance criteria omit tests, the criteria are incomplete — write them anyway.
- **Test-first where the behaviour is specifiable.** For `core`, `verifier`, and `server`, the expected input/output is knowable before the implementation exists; write the failing test first. Bug fixes always start with a test that reproduces the bug.
- **Never weaken a test to make it pass.** Do not delete assertions, loosen a matcher, widen a tolerance, add a skip, or mark something `todo` to get CI green. If a test fails, either the code is wrong or the test encodes a stale expectation — say which, and fix that. Silently disabling a test is the worst possible outcome.
- **Report test results honestly.** If tests fail, show the output and say so. Never describe work as done or verified when the suite is red, was not run, or was only partially run.
- **No mocking the thing under test.** Mock the network and the wallet; never mock CBOR decoding, effects derivation, or schema validation — those are the behaviour being proved.

What "tested" means per package:

| Package | The bar |
|---|---|
| `core` | Every schema validated against both valid and malformed payloads. Every URL / `slips.json` resolution rule has a case, including the ones that must be rejected. Every error code is reachable in a test. |
| `verifier` | The highest bar in the repo. Property-style coverage of derivation arithmetic, `test/fixtures/` for known-good regressions, and `test/attacks/` for transactions whose declared metadata lies. **Every attack case must be blocked, and the set of attack examples grows with every bug** — any transaction that should have been blocked and wasn't becomes a permanent test case. |
| `server` | `defineSlip` output validated against `core` schemas; CORS, HTTP status mapping, and each spec error code exercised. |
| `identity` | Attestation issue/resolve round-trip, plus explicit tests for invalid, expired, and absent attestations — an unverified publisher must render as unverified, never as verified. |
| `flow` | Component tests for the effects panel and the mismatch block, wallet flow tested against a stubbed CIP-30 provider, and the rebuild-and-retry path covered. |
| apps / examples | The critical user path end-to-end. Not every pixel — the flow that must not break. |

The **hard invariants below each need a test that fails if the invariant is broken.** An invariant nothing tests is a comment, not a guarantee.

## Hard invariants (violating these is a bug, whatever the ticket says)

1. `packages/verifier` stays a pure function of (tx CBOR, declared metadata, user addresses). It must not import from `flow`, `server`, or any network layer.
2. The client never sends the user's UTxO set to a Slip endpoint (Mode A only in v1).
3. A metadata/effects mismatch always hard-blocks signing. No override paths, no allowlists.
4. `signTx` returns a witness set, not a signed tx — witnesses are assembled into the body before `submitTx`.
5. Nothing in this codebase ever holds, custodies, or relays user funds.
6. Transactions we generate ourselves never count as adoption. Team and test wallets are recorded and excluded from any usage figure we publish.

## Conventions a linter can't enforce

- Effect for services/errors; typed errors over thrown exceptions in library code.
- Public API surfaces validated with Effect Schema at the boundary; internal code trusts types.
- ESM only, explicit file extensions in relative imports per NodeNext.
- User-facing failures (client, slip page) must map to spec error codes with human-readable messages — never raw stack traces.
