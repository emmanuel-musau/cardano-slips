# Workflow

How work moves from the board to `main`. Written for a two-person team at ~4.5 person-days/week — the process exists to remove decisions, not to add ceremony.

## The board

Issues: `emmanuel-musau/cardano-slips` · Board: https://github.com/users/emmanuel-musau/projects/1

76 issues, numbered in dependency order. Fields: **Status**, **Points**, **Epic**, **Priority**.

**Columns.** `Backlog` → `Ready` → `In progress` → `In review` → `Done`. Backlog and Ready are both ordered top-to-bottom in the order work should happen, so the next thing to do is always the top of `Ready`.

**Pulling work.** When an issue closes, promote items from the top of `Backlog` into `Ready` — anything whose `Depends on #N` issues are all closed is eligible. Never start an issue with an open dependency; if it seems necessary, the dependency is wrong and should be fixed on the issue.

**Priority.** `P0` = critical path, a slip here slips the milestone (the three risk spikes, the effects engine, balancing/signing, slip page flow, mainnet deploy). `P1` = normal. `P2` = deferrable polish — what gets consciously pushed in a short week.

**Points.** Fibonacci, capped at 5: `1` ≈ under 2 hours (config-level) · `2` ≈ half a day · `3` ≈ one day · `5` ≈ two days. Nothing is larger. If an issue starts feeling like an 8, stop and split it into new issues rather than absorbing the overrun silently.

**Milestones.** `M1-Foundation` → `M1-Protocol` → `M1-Verifier` → `M1-Flow` → `M1-Integration` → `M1-Delivery`.

## Build order

The first three commits go in this order, and the third is the one people skip:

| # | Commit | Why here |
|---|---|---|
| 1 | Root setup — `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js` | Nothing else builds correctly until the workspace resolves. |
| 2 | `LICENSE`, `README`, CI workflow, issue templates, `CODEOWNERS` | Establishes the repo as public and contributable from commit two, not as an afterthought. |
| 3 | `packages/core` with one passing test | Proves the toolchain end to end — workspace resolution, TypeScript, Vitest, Turborepo caching, CI — before anything real is built on top of it. |

Do not skip commit three. Discovering a broken ESM resolution chain in week six, with the effects engine half-written on top of it, costs days.

## Branch, commit, PR

One issue = one branch = one PR.

```
git switch -c feat/verifier-scaffold
```

Branch names are `<type>/<purpose>` — the type prefix, a slash, then the purpose in kebab-case. No issue numbers, no other punctuation. Type is `feat`, `fix`, `chore`, `docs`, `test`, `spec`, or `infra`; the purpose is one or two words naming the thing: `chore/pnpm-workspace`, `feat/ada-delta`, `fix/mismatch-block`. The issue number belongs in the commit trailer and the PR body, where it actually links.

**Commits** follow Conventional Commits, scoped by package where one applies:

```
feat(verifier): derive net ADA delta and exact fee

Refs #36
```

**Commit and PR text must never reference AI tooling** — no `Co-Authored-By` trailers for assistants, no "generated with" footers. The author is the human committer. See `CLAUDE.md`.

**PRs** state what changed and why, link the issue (`Closes #36`), and tick that issue's acceptance criteria. `main` is protected: PR required, CI green required, squash merge, head branch auto-deleted. Never push to `main` directly.

## Definition of done

An issue is done when:

- Every acceptance-criteria checkbox on the issue is ticked.
- **Tests ship in the same PR as the code.** Not a follow-up ticket, not a TODO, not "covered by the integration test later". An issue whose acceptance criteria forgot to mention tests still needs them.
- **The new behaviour actually has a test that would fail without it.** Coverage that only exercises the happy path is not done — the rejection cases, the error codes, and the invariants each need a case.
- **No test was weakened to get here.** No deleted assertions, loosened matchers, `skip`, or `todo` added to make CI pass. If an existing test now fails, the PR says which is wrong — the code or the expectation — and fixes that.
- CI is green: lint, typecheck, test, build. Green means the suite ran in full, not that it was skipped.
- A changeset is included for any change under `packages/*`.
- Docs are updated when behaviour a user or integrator sees has changed.
- Nothing in scope was silently expanded. New scope becomes a new issue.

## Decisions

Settled decisions live in `docs/DECISIONS/` as ADRs. Do not relitigate one in a PR — write a new ADR that supersedes it. Two ADRs are already ticketed as spikes because they block other work: CBOR decode approach (#33) and CIP-0170 go/no-go (#63).

If a ticket turns out to depend on an unmade decision, stop and make the decision its own small spike issue first. Tickets should never require judgement calls the backlog hasn't already settled.

## Spec changes

Once the CIP draft is frozen (#21), request/response shapes are a versioned contract. Changing one means a spec PR, a version bump, and updates to `core` schemas and their tests in the same change — never a silent edit to a shape that packages already implement.

## Releases

Changesets drives versioning. A changeset accompanies every `packages/*` change; the release workflow opens a version PR and publishes to npm on merge. Four packages ship publicly: `core`, `server`, `verifier`, `flow`.

## Environments

`preprod` for all end-to-end work (issue #54 provisions wallets and provider keys; `.env.example` documents the variables). Mainnet is touched only by the deployment issues (#63, #67).

Team and test wallets are recorded and excluded from usage figures. No transaction we generate ourselves is ever counted as adoption.
