# Workflow

How work moves from the board to `main`. Written for a two-person team at ~4.5 person-days/week — the process exists to remove decisions, not to add ceremony.

## The board

Issues: `emmanuel-musau/cardano-slips` · Board: https://github.com/users/emmanuel-musau/projects/1

76 issues, numbered in dependency order. Fields: **Status**, **Points**, **Epic**, **Priority**.

**Columns.** `Backlog` → `Ready` → `In progress` → `In review` → `Done`. Backlog and Ready are both ordered top-to-bottom in the order work should happen, so the next thing to do is always the top of `Ready`.

**Pulling work.** When an issue closes, promote items from the top of `Backlog` into `Ready` — anything whose `Depends on #N` issues are all closed is eligible. Never start an issue with an open dependency; if it seems necessary, the dependency is wrong and should be fixed on the issue.

**Priority.** `P0` = critical path, a slip here slips the milestone (the three risk decisions, the effects engine, balancing/signing, slip page flow, mainnet deploy). `P1` = normal. `P2` = deferrable polish — what gets consciously pushed in a short week.

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

## Branches

Two branches are permanent.

**`main` is the published branch**, and the only one releases publish from.
It is protected against everyone, the owner included: a pull request, four green
checks, and a code owner review, with no admin bypass. Never push to `main`
directly.

**`dev` is where work happens**, and it is the default branch — new pull
requests therefore target it without anyone having to change the base. The same
four checks are required on any pull request into it, so a contribution is gated
exactly as it would be on `main`. The repository owner is exempt and commits
straight to `dev` — that is what it is for. CI runs on every push there, so a
break surfaces on the commit that caused it rather than at merge time.
`release.yml` never triggers from `dev`.

Two things follow from `dev` being the default. A visitor to the repository
lands on `dev` rather than on the released code, so `dev` has to stay
presentable — a broken `README` there is the repository's front page. And
Dependabot opens its pull requests against the default branch, so dependency
bumps now arrive on `dev`, which is where they should be reviewed anyway.
Changesets is unaffected: `.changeset/config.json` pins `baseBranch` to `main`
explicitly, so versioning stays anchored to what actually shipped.

`dev` merges into `main` with a **merge commit**, so `main` keeps one commit per
ticket rather than one per release. Everything else squashes.

After a release, `main` is fast-forwarded back into `dev` by the `backmerge`
job — see Releases below. It is refused rather than forced when `dev` moved
during the release, and the merge is then yours to do.

## Branch, commit, PR

One issue = one branch = one PR. Feature branches start from `dev` and target
`dev`; only `dev` targets `main`. Note that GitHub bases a new pull request on
`main` by default, so a branch meant for `dev` needs its base changed —
`gh pr create --base dev` avoids the trip through the web UI.

The owner may commit small work straight to `dev` without a branch: docs, typo
fixes, comments, chores. Anything with acceptance criteria still gets its issue,
its branch and its pull request, because that is what ticks the criteria off.

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

**PRs** state what changed and why, link the issue (`Closes #36`), and tick that issue's acceptance criteria. Both permanent branches require the four checks; `main` additionally requires a code owner review and exempts nobody.

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

Settled decisions live in `docs/DECISIONS/` as ADRs. Do not relitigate one in a PR — write a new ADR that supersedes it. Two ADRs are already ticketed as decisions because they block other work: CBOR decode approach (#33) and CIP-0170 go/no-go (#63).

If a ticket turns out to depend on an unmade decision, stop and make the decision its own small ticket first. Tickets should never require judgement calls the backlog hasn't already settled.

## Spec changes

Once the CIP draft is frozen (#21), request/response shapes are a versioned contract. Changing one means a spec PR, a version bump, and updates to `core` schemas and their tests in the same change — never a silent edit to a shape that packages already implement.

## Releases

Changesets drives versioning. A changeset accompanies every `packages/*` change; the release workflow opens a version PR and publishes to npm on merge. Four packages ship publicly: `core`, `server`, `verifier`, `flow`.

Releasing runs in this order. The last step used to be the one that got
forgotten, so it is now a job:

1. Open the `dev` -> `main` pull request and merge it with a merge commit.
2. `release.yml` fires on the push to `main` and opens the Changesets version PR.
3. Merge the version PR. That push publishes to npm.
4. The `backmerge` job fast-forwards `dev` onto `main`. `main` now carries
   version bumps and changelogs that `dev` does not, and left alone every
   later `dev` -> `main` pull request drags a stale diff behind it.

`backmerge` moves the branch through the refs API, which refuses anything but a
fast-forward, so it can only go red when someone pushed to `dev` during the
release window. That is a published release with an outstanding merge, not a
torn one — finish it by hand:

```
git switch dev && git pull origin main && git push
```

### The release App

`release.yml` opens the version PR with a GitHub App token rather than
`GITHUB_TOKEN`, because a pull request opened with `GITHUB_TOKEN` does not
trigger workflows — GitHub's recursion guard, and not configurable. `ci.yml`
would never run on the version PR, its four required checks would never report,
and the PR could not be merged without weakening branch protection for every PR
in the repository. An App installation token is not `GITHUB_TOKEN`, so the PR it
opens is checked like any other, and unlike a PAT it is short-lived and scoped
to this repository.

The App needs Contents: read & write and Pull requests: read & write, and it
must be *installed* here — creating it is not enough. Without an installation
the token step fails with a 404 from
`get-a-repository-installation-for-the-authenticated-app`, which is a different
failure from the 401 that bad credentials produce. Its credentials are the
`RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY` secrets — `client-id`
rather than `app-id`, since v3 of the action deprecated the numeric App ID in
favour of the client id on the same settings page.

## Dependencies

`@evolution-sdk/evolution` and Effect both move fast, and a dependency left
alone for a quarter stops being a one-line bump and becomes an afternoon. So
Dependabot runs weekly, configured in `.github/dependabot.yml`.

Dependabot rather than Renovate: it is native to GitHub, so there is no app to
install and no third party holding write access here.

**Nothing merges itself.** Dependabot opens pull requests; they pass the same
four checks as any other PR and a human merges them. Auto-merge is deliberately
not configured — neither in that file, which cannot express it, nor as a
workflow that would. Everything moving within its major arrives as one Monday
pull request; majors come one at a time, each with its own CI run and its own
read of the changelog.

Recent npm supply-chain compromises were caught within days of publish and
nothing here is urgent enough to be a new version's first install, so releases
sit in cooldown before we are offered them. Security updates skip it.

## Environments

`preprod` for all end-to-end work (issue #54 provisions wallets and provider keys; `.env.example` documents the variables). Mainnet is touched only by the deployment issues (#63, #67).

Team and test wallets are recorded and excluded from usage figures. No transaction we generate ourselves is ever counted as adoption.
