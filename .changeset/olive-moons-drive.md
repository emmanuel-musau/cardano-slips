---
"@cardano-slips/flow": patch
---

Scaffold the package: ESM `exports` map, the four-file TypeScript project layout, and its Vitest project — the same shape `core`, `verifier` and `server` carry, plus the two things only this package needs. React 19 is a peer dependency, and the sources compile through the automatic JSX runtime with React's types in place of Node's.

Three tests come with it. `test/scaffold.test.ts` proves the toolchain resolves the entry point and that the manifest promises npm what the build writes. `test/dependencies.test.ts` holds the architecture's dependency direction over the real code — no import of `server`, nothing imported that was not declared — and fails if React ever moves out of `peerDependencies`. `test/browser.test.tsx` renders a component to prove the JSX transform, React's types and the happy-dom environment agree with each other, and scans the sources for a Node builtin that would reach a bundler. No API yet — wallet discovery, balancing, the effects panel and the mismatch block land in their own issues.
