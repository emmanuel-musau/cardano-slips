---
"@cardano-slips/server": patch
---

Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core` and `verifier` carry.

Two tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/dependencies.test.ts` is the architecture's dependency rule over the real code: it walks every source file for an import of `flow` or `verifier`, holds the manifest to a reviewed list, and fails on anything imported that was never declared. No API yet — `defineSlip`, the CORS and status mapping, `slips.json` serving and the Next.js adapter land in their own issues.
