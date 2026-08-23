# Contributing

Thanks for looking. This is an open specification, plus the TypeScript SDK
that implements it. The specification belongs to the ecosystem rather than to
this repository, and outside contributions are welcome on that basis.

Read this page before opening a PR. It is short, and the parts that look
strict — tests, the mismatch invariant, spec changes — are the parts that make
the security argument work.

## What this project is

A client turns a shared URL into a signable Cardano transaction. Because a
Cardano transaction body fully determines its own effects, the client
**derives** exactly what a transaction does and blocks the signature when that
contradicts what the link claimed. There is no registry, no custody, and no
relayer. Nothing here ever holds user funds.

That single idea sets most of the rules below. Start with
[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for scope and the security model,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for package boundaries.

## Setup

Requires Node 22 or newer and pnpm 11 or newer. The pnpm version is pinned in
`package.json` under `packageManager`, so enabling Corepack is the easiest way
to get the right one:

```sh
corepack enable
git clone https://github.com/emmanuel-musau/cardano-slips.git
cd cardano-slips
pnpm install
```

Then:

```sh
pnpm lint         # eslint + prettier, root and every package
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # vitest via turbo
pnpm build        # turbo build
pnpm format       # rewrite formatting rather than just reporting it
```

CI runs those same four as separate checks. Run them locally before pushing —
they are quick, and a red CI run is slower than a local one.

## Picking something to work on

Work is driven by [GitHub issues](https://github.com/emmanuel-musau/cardano-slips/issues),
ordered by dependency. Maintainers mirror that ordering on an internal project
board, and **the issue list is the public view of it** — it carries everything
you need to pick something up.

- Issues carry `Depends on #N` lines. **Do not start an issue whose
  dependencies are still open** — the ordering exists because building out of
  order produces work that has to be redone.
- An open issue with no open dependencies and nobody assigned is fair game.
- Comment on an issue before starting so two people do not build the same
  thing.
- If you want to propose something that is not on the board, open an issue
  first. A PR for unticketed work is likely to be asked to become an issue
  before it is reviewed.

## Branch, commit, PR

One issue, one branch, one PR.

Branch names are `<type>/<purpose>` — the type, a slash, then the purpose in
kebab-case. No issue numbers, no other punctuation:

```sh
git switch -c feat/ada-delta
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `spec`, `infra`. The purpose is
one or two words naming the thing (`fix/mismatch-block`), not a sentence.

Commits follow [Conventional Commits](https://www.conventionalcommits.org),
scoped by package where one applies, and reference the issue in a trailer:

```
feat(verifier): derive net ADA delta and exact fee

Refs #36
```

The PR body links the issue with `Closes #36` and ticks that issue's acceptance
criteria. `main` is protected: PR required, CI green required, squash merge.
Never push to `main`.

PRs open with an empty body. The definition-of-done checklist lives in
`.github/PULL_REQUEST_TEMPLATE/default.md` and is opt-in — reach for it when a
change is large enough that the checklist earns its space:

```sh
gh pr create --template default.md
```

On the web, append `?template=default.md` to the compare URL.

## Tests are not optional

This is the rule most likely to get a PR sent back, so it is worth being blunt
about it: **code without tests is not finished work here.** Not a follow-up
ticket, not a TODO, not "covered by the integration test later".

- Tests ship in the **same PR** as the code.
- Write the test first wherever the behaviour is specifiable — for `core`,
  `verifier`, and `server`, the expected input and output are knowable before
  the implementation exists. Bug fixes always start with a test that reproduces
  the bug.
- The new behaviour needs a test **that would fail without it**. A happy-path
  assertion that passes against an empty function is not coverage.
- **Never weaken a test to get CI green.** No deleted assertions, no loosened
  matchers, no widened tolerances, no `skip`, no `todo`. If a test fails,
  either the code is wrong or the test encodes a stale expectation — say which
  in the PR, and fix that one.
- Mock the network and the wallet. Never mock CBOR decoding, effects
  derivation, or schema validation; those are the behaviour under test.

`packages/verifier` carries the highest bar. Its set of attack examples grows with
every bug: **any transaction that should have been blocked and wasn't becomes a
permanent test case.** If you find one, the test case is the most valuable half
of the contribution.

## Changesets

Any change under `packages/*` needs a changeset in the same PR:

```sh
pnpm changeset
```

Pick the affected packages and a bump — `patch` for a fix, `minor` for new
surface, `major` for a break. Write the summary for someone reading a
changelog, not for a reviewer reading the diff. Packages version and publish
independently: a fix in `verifier` must not force a `flow` release.

Changes outside `packages/*` — docs, CI, tooling — do not need one. Neither do
test-only changes inside a package: they change nothing a consumer installs.

CI checks this. A PR that touches a package without a changeset fails the
`changeset` job, which runs `changeset status` against the base branch.

## Releasing

Maintainers only. Nothing about it is manual beyond one merge.

Every push to `main` runs `.github/workflows/release.yml`. If changesets are
pending, it opens or updates a **chore: version packages** PR holding the
version bumps and CHANGELOG entries those changesets produce. Merging that PR
is the release decision — you are looking at the exact versions and the exact
changelog about to ship. On merge, no changesets remain, and the same workflow
publishes to npm, pushes tags, and creates the GitHub releases.

Authentication is [npm trusted publishing](https://docs.npmjs.com/trusted-publishers):
the job mints a short-lived credential over OIDC from the `npm` environment.
There is no publish token in this repository's secrets, and provenance
attestations — proof that a tarball was built from this commit by this
workflow — are generated automatically.

One-time setup per package, before its first release: the npm scope must exist
and the package must have a trusted publisher pointing at this repository,
`release.yml`, and the `npm` environment.

Packages start at `0.x`. Until `1.0.0`, a breaking change is a `minor` bump.

## Dependency updates

Dependabot keeps them current. One grouped pull request per ecosystem every
Monday holding everything that moved inside its major, and a separate pull
request for each major, so no breaking bump arrives buried in a batch of
eleven others. A release has to be a few days old before it is offered.
`.github/dependabot.yml` carries the reasoning behind each setting.

Nothing merges itself. A dependency pull request runs lint, typecheck, test
and build like any other, and a person merges it. There is no auto-merge in
this repository and adding one would fail `test/dependency-updates.test.ts`.

A bump that touches a `packages/*` manifest still needs a changeset, and
Dependabot cannot write one. Push it onto the branch before merging:

```sh
git fetch origin dependabot/npm_and_yarn/...
git switch dependabot/npm_and_yarn/...
pnpm changeset          # a runtime dependency of a published package
pnpm changeset --empty  # a dev dependency, or anything a consumer never sees
```

## Changing the specification

The CIP in `spec/` is a versioned contract that other implementations depend
on. Changing a request or response shape is never a silent edit.

A spec change is a PR against `spec/` **first**, and it carries the version
bump plus the `core` schema and test updates in the same change. Use the
**Spec change** issue template to propose it before writing the PR.

## Things that will block a PR

These are invariants, not preferences. A PR that breaks one is wrong even when
the ticket asked for it — raise the conflict on the issue instead.

1. `packages/verifier` stays a pure function of the transaction CBOR, the
   declared metadata, and the user's addresses. It must not import from
   `flow`, `server`, or any network layer.
2. The client never sends the user's UTxO set to a Slip endpoint.
3. A metadata/effects mismatch always hard-blocks signing. No override paths,
   no allowlists, no "advanced user" escape hatch.
4. `signTx` returns a witness set, not a signed transaction. Witnesses are
   assembled into the body before `submitTx`.
5. Nothing in this codebase holds, custodies, or relays user funds.

Each of those has a test that fails if it is broken. If you change one of those
tests, you are changing the security model, and that needs an ADR in
[docs/DECISIONS/](docs/DECISIONS/) — not a PR comment.

## Architecture decisions

Settled decisions live in `docs/DECISIONS/` as ADRs. Do not relitigate one in a
PR thread; write a new ADR that supersedes it. If a ticket turns out to depend
on a decision nobody has made, say so on the issue and let the decision become
its own small spike rather than a judgement call buried in an implementation
PR.

## Reporting a security problem

Do not open a public issue for a vulnerability — particularly one that lets a
transaction's real effects differ from what a user was shown. Use GitHub's
[private vulnerability reporting](https://github.com/emmanuel-musau/cardano-slips/security/advisories/new)
instead.

[SECURITY.md](SECURITY.md) has the full policy: what is in and out of scope,
what to include in a report, and what response times to expect.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers this repository.
