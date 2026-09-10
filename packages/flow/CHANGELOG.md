# @cardano-slips/flow

## 0.1.0

### Minor Changes

- [#161](https://github.com/emmanuel-musau/cardano-slips/pull/161) [`862e553`](https://github.com/emmanuel-musau/cardano-slips/commit/862e55348b6c2065e4d7a19606ac6603ef395faf) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Add `tokens.css` — colour, type, spacing and radius as CSS custom properties, taken from the design sheet. Scoped to a `slip-root` class rather than `:root`, because a package dropped into someone else's page must not redefine what that page already calls `--ink`; there is no reset in it and no rule that selects an element, so an inherited font stack survives. `data-theme="dark"` is the whole of the theme rule, rebinding the roles so a component writes `var(--ink)` once and is right in both themes — with the fixed dark palette for code blocks and the Open Graph card deliberately outside it, since a value that is fixed cannot also follow. Exported as `@cardano-slips/flow/tokens.css`, so the hosted page and a third party resolve the same file. Two tests hold it: nothing outside the token file writes a colour, and the sheet's contrast audit is recomputed against the values rather than copied in.

- [#160](https://github.com/emmanuel-musau/cardano-slips/pull/160) [`2d314ab`](https://github.com/emmanuel-musau/cardano-slips/commit/2d314ab6719a0d59cbe8e1280dafbfa0575935cb) Thanks [@emmanuel-musau](https://github.com/emmanuel-musau)! - Discover and connect a CIP-30 wallet. `discoverWallets` reads `window.cardano` on demand — never at module load, so the package stays importable in a page rendered on a server — and names a wallet from our own registry, letting one it does not know name itself. `connectWallet` enables, then holds the wallet to the network the Slip declares: the reported network id and the network its own change address encodes must agree with it and with each other, and a change address comes back as bech32 ready for the `POST` body. Failure is a typed refusal per state a person can be shown, and a declined connection keeps the wallet's own CIP-30 `{ code, info }` so `-3` stays distinguishable from a crash.

### Patch Changes

- Updated dependencies [[`c6fd67a`](https://github.com/emmanuel-musau/cardano-slips/commit/c6fd67a51a5bba9e2c642d38629d28253e0249dc), [`c194003`](https://github.com/emmanuel-musau/cardano-slips/commit/c194003eeb2a68889a1bfe470b58ce000c7e459d), [`ce87c87`](https://github.com/emmanuel-musau/cardano-slips/commit/ce87c8787b93e4a3bde69776baa65f73b87c2f28), [`2241678`](https://github.com/emmanuel-musau/cardano-slips/commit/2241678462552eeec34d3c390893f072bb701fff), [`d1fdef8`](https://github.com/emmanuel-musau/cardano-slips/commit/d1fdef8a5863df9664dc3eea2d3a8a16e64b6589)]:
  - @cardano-slips/verifier@0.2.0

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
