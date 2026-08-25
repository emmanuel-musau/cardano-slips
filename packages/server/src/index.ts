/**
 * The public entry point of `@cardano-slips/server`. The `exports` map exposes
 * this module and nothing else, so moving a file is never a breaking change.
 *
 * A `defineSlip` handler's output is validated against the `core` schemas
 * before it leaves the server, so a bad response fails at the publisher's own
 * boundary rather than at a stranger's wallet. Installing this must not pull in
 * a React tree or a CBOR decoder; `test/dependencies.test.ts` enforces it.
 */
export {}
