<!--
Title follows Conventional Commits, scoped by package where one applies:
  feat(verifier): derive net ADA delta and exact fee
-->

Closes #

## What changed and why

<!-- What a reviewer needs to know to read the diff. The why matters more
     than the what — the diff already says what. -->

## Tests

<!-- Which tests ship with this, and which of them would fail without the
     change. "Covered by existing tests" is an answer only if you can name
     the test and say why it exercises the new path.

     If this fixes a bug, name the test that reproduces it.
     If this touches `verifier`, say what was added to the attack examples. -->

## Checklist

- [ ] Every acceptance-criteria checkbox on the linked issue is ticked.
- [ ] Tests ship in this PR, and the new behaviour has a test that would fail without it.
- [ ] No test was weakened to get here — nothing deleted, loosened, skipped, or marked todo.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally.
- [ ] A changeset is included, if anything under `packages/*` changed.
- [ ] Docs are updated, if behaviour a user or integrator sees has changed.
- [ ] Scope was not expanded — anything extra became a new issue.

## Invariants

Tick only if this PR touches one. Breaking one of these is a bug whatever the
ticket says; if the ticket seems to require it, stop and raise it on the issue.

- [ ] `verifier` stays pure — no imports from `flow`, `server`, or any network layer.
- [ ] The client still never sends the user's UTxO set to a Slip endpoint.
- [ ] A metadata/effects mismatch still hard-blocks signing, with no override path.
- [ ] `signTx` still returns a witness set, assembled into the body before `submitTx`.
- [ ] Nothing added here holds, custodies, or relays user funds.
