/**
 * The public entry point of `@cardano-slips/flow`.
 *
 * Everything a consumer may import is re-exported from here, and the package
 * `exports` map exposes this module and nothing else — a deep import into
 * `dist/` is not a supported surface, so moving a file is never a breaking
 * change. The package lands one issue at a time: wallet discovery and enable,
 * local balancing, the effects panel and the mismatch block, the parameter
 * form, and rebuild-and-retry (docs/ARCHITECTURE.md).
 *
 * This is the half that runs in a browser next to a wallet, and two things
 * about it do not change as the rest arrives.
 *
 * **It refuses; it does not decide.** The comparison between what a
 * transaction does and what the endpoint declared is `verifier`'s, and it is a
 * pure function so that the attack examples exercise the same code a real
 * signature runs through. What lives here is the consequence: a mismatch
 * renders as a block with no control to press, and there is no override path
 * to write — not a setting, not an allowlist, not a confirmation.
 *
 * **It does not own the page it is dropped into.** These components go into
 * third-party pages: no fixed positioning, no assumption about the document,
 * and styles that survive an inherited font stack. Design tokens live in
 * `tokens.css` as custom properties and are the only source of a colour.
 */
export {}
