/**
 * The public entry point of `@cardano-slips/server`.
 *
 * Everything a consumer may import is re-exported from here, and the package
 * `exports` map exposes this module and nothing else — a deep import into
 * `dist/` is not a supported surface, so moving a file is never a breaking
 * change. The package lands one issue at a time: `defineSlip`, the CORS and
 * status mapping, `slips.json` serving, and the Next.js App Router adapter
 * (docs/ARCHITECTURE.md).
 *
 * What does not change as those arrive is where a bad response is caught. A
 * `defineSlip` handler's output is validated against the `core` schemas
 * *before it leaves the server*, so a publisher who declares a shape the spec
 * does not define fails at their own boundary — not at a stranger's wallet,
 * where the same mistake reaches a person as a Slip that will not load.
 *
 * The other fixed property is what this package must never pull in. A dApp
 * shipping an endpoint installs this and gets a request handler; it does not
 * get a React tree or a CBOR decoder. `test/dependencies.test.ts` fails if an
 * import ever crosses that line.
 */
export {}
