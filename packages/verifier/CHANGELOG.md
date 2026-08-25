# @cardano-slips/verifier

## 0.0.2

### Patch Changes

- Updated dependencies [[`a9c1c59`](https://github.com/emmanuel-musau/cardano-slips/commit/a9c1c59ba4174e4f5be63a0b195e7fd13d7498c9), [`81a35d2`](https://github.com/emmanuel-musau/cardano-slips/commit/81a35d28f7deee739c91ba7f9621619db2704c08), [`b29417c`](https://github.com/emmanuel-musau/cardano-slips/commit/b29417c5055b1edfc0f2a753456889e0267e2190)]:
  - @cardano-slips/core@0.1.0

## 0.0.1

### Patch Changes

- [#112](https://github.com/emmanuel-musau/cardano-slips/pull/112) [`b9256cc`](https://github.com/emmanuel-musau/cardano-slips/commit/b9256ccfe44584c5e4e290c8854b96d71daf9fa2) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core` carries.
  
  Two tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/no-io.test.ts` is hard invariant 1 over the real code: it walks every source file for an import or a global that could reach a disk, a socket or another process, holds the manifest to a reviewed dependency list, and loads the module with those routes trapped. No API yet — decode, derivation, deposits and the comparison land in their own issues.
