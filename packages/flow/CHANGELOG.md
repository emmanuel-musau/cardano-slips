# @cardano-slips/flow

## 0.0.3

### Patch Changes

- Updated dependencies [[`7c9d1fb`](https://github.com/emmanuel-musau/cardano-slips/commit/7c9d1fb608279b985f8bec062374550aee96967e), [`9ed2ff5`](https://github.com/emmanuel-musau/cardano-slips/commit/9ed2ff59a108a1c7b18823dca1f8c4e445ecf190), [`8d53fb2`](https://github.com/emmanuel-musau/cardano-slips/commit/8d53fb2e00e1953194f097b53bcb07d2911794ce), [`77ed6d9`](https://github.com/emmanuel-musau/cardano-slips/commit/77ed6d992549d8062cce55b5357c2941adad72c0)]:
  - @cardano-slips/verifier@0.1.0
  - @cardano-slips/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [[`a9c1c59`](https://github.com/emmanuel-musau/cardano-slips/commit/a9c1c59ba4174e4f5be63a0b195e7fd13d7498c9), [`81a35d2`](https://github.com/emmanuel-musau/cardano-slips/commit/81a35d28f7deee739c91ba7f9621619db2704c08), [`b29417c`](https://github.com/emmanuel-musau/cardano-slips/commit/b29417c5055b1edfc0f2a753456889e0267e2190)]:
  - @cardano-slips/core@0.1.0
  - @cardano-slips/verifier@0.0.2

## 0.0.1

### Patch Changes

- [#117](https://github.com/emmanuel-musau/cardano-slips/pull/117) [`8dae482`](https://github.com/emmanuel-musau/cardano-slips/commit/8dae482f99765f3afd1eec413e3389aab60fbeca) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core`, `verifier` and `server` carry, plus the two things only this package needs. React 19 is a peer dependency, and the sources compile through the automatic JSX runtime with React's types in place of Node's.
  
  Three tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/dependencies.test.ts` holds the architecture's dependency direction over the real code — no import of `server`, nothing imported that was not declared — and fails if React ever moves out of `peerDependencies`. `test/browser.test.tsx` renders a component to prove the JSX transform, React's types and the happy-dom environment agree with each other, and scans the sources for a Node builtin that would reach a bundler. No API yet — wallet discovery, balancing, the effects panel and the mismatch block land in their own issues.
