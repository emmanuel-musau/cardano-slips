---
"@cardano-slips/verifier": patch
---

Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core` carries.

Two tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/no-io.test.ts` is hard invariant 1 over the real code: it walks every source file for an import or a global that could reach a disk, a socket or another process, holds the manifest to a reviewed dependency list, and loads the module with those routes trapped. No API yet — decode, derivation, deposits and the comparison land in their own issues.
