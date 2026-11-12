# ADR-0016: Publish `identity` to npm with the other four packages

**Status:** Accepted
**Date:** 2026-11-12
**Issue:** #205

## Context

ADR-0005 names five packages. Until now only four were planned for npm:
`core`, `server`, `verifier` and `flow`. `identity` was left out while
CIP-0170's go/no-go was open, on the reading that the package might not exist at
all.

That reading does not hold. ADR-0006 split the tiers so that cutting Tier 2
leaves the identity layer shipping, and REQUIREMENTS §5 puts Tier 1 in v1
unconditionally. Tier 1 lives in `identity`, so the package exists whatever
CIP-0170's go/no-go decides. ADR-0014, still Proposed, recommends cutting Tier
2 from M1; either outcome leaves `identity` in place.

`flow` is the package that renders the publisher line, so it is the one that
consumes `identity` (docs/ARCHITECTURE.md, and the dependencies `flow`'s own
test already allows). `flow` is published. `pnpm publish` rewrites
`workspace:^` into a real version range, so a published package that depends on
an unpublished one fails to install for everyone who adds it.
`test/publishing.test.ts` already refuses that.

## Decision

`@cardano-slips/identity` publishes to npm under the same rules as the other
four: public access, MIT, independent versioning through Changesets. The first
release that carries it publishes the empty scaffold, which also reserves the
name.

## Alternatives considered

**Keep `identity` private and bundle it into `flow`.** It would avoid a fifth
package on npm, but `flow` would then ship identity code inside its own build,
and the separate package exists so that cutting Tier 2 is deleting a dependency
line (ADR-0006). Bundling undoes that, and a wallet that wants to resolve a
publisher manifest without React could no longer install it alone.

**Keep it private until `flow` needs it.** It would delay the npm entry, but the
ticket that has `flow` resolve the manifest (#62) would then have to make the
package public as well. Deciding it now keeps that change about resolution, not
about release configuration.

## Consequences

Five packages ship rather than four. The release ticket (#70), REQUIREMENTS §7
and WORKFLOW say five.

An empty `identity` package appears on npm at the next release, as `flow` did
before it had an API. Its README says nothing is exported yet.

The release workflow publishes through npm trusted publishing, which needs a
trusted publisher set up for each package before its first release
(docs/WORKFLOW.md). Until the owner has done that for `identity`, the next
release fails partway through, with some packages published and others not.
`core` and `flow` each have a 0.0.0 on npm from minutes after their scaffold
commits, before any version PR, which is how that step was done for them.

Reversing this after a release means deprecating a published package rather
than editing a list. Until the next release it is a one-line change in
`test/publishing.test.ts` and `"private": true` in the manifest.
