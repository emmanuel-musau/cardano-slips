# @cardano-slips/server

## 0.0.2

### Patch Changes

- Updated dependencies [[`a9c1c59`](https://github.com/emmanuel-musau/cardano-slips/commit/a9c1c59ba4174e4f5be63a0b195e7fd13d7498c9), [`81a35d2`](https://github.com/emmanuel-musau/cardano-slips/commit/81a35d28f7deee739c91ba7f9621619db2704c08), [`b29417c`](https://github.com/emmanuel-musau/cardano-slips/commit/b29417c5055b1edfc0f2a753456889e0267e2190)]:
  - @cardano-slips/core@0.1.0

## 0.0.1

### Patch Changes

- [#116](https://github.com/emmanuel-musau/cardano-slips/pull/116) [`d372237`](https://github.com/emmanuel-musau/cardano-slips/commit/d372237f72c0648568de94ca22b4fbd9094f720b) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core` and `verifier` carry.
  
  Two tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/dependencies.test.ts` is the architecture's dependency rule over the real code: it walks every source file for an import of `flow` or `verifier`, holds the manifest to a reviewed list, and fails on anything imported that was never declared. No API yet — `defineSlip`, the CORS and status mapping, `slips.json` serving and the Next.js adapter land in their own issues.
