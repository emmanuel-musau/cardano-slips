# @cardano-slips/identity

Publisher identity: who is asking for the signature. A publisher serves a signed manifest at `https://<domain>/.well-known/cardano-slips.json` binding their domain to the Slip endpoints they vouch for, and a client resolves it to show "published by `<domain>`, domain-verified" beside the effects.

```
pnpm add @cardano-slips/identity
```

Nothing is exported yet. Issuing and resolving the manifest land in their own issues; [ARCHITECTURE.md](../../docs/ARCHITECTURE.md#identity) and [REQUIREMENTS.md §5](../../docs/REQUIREMENTS.md#5-identity-layer) describe what is coming.

## What it never does

Identity never gates a signature. A missing, invalid, expired or revoked manifest renders as unverified, and a verified publisher never relaxes the effects check. The two are independent by design.

It is a leaf: `flow` is the only package allowed to depend on it, and it never reaches for `flow`, `server` or `verifier`. `test/dependencies.test.ts` holds both rules.

MIT licensed. Issues and contribution guide: [cardano-slips](https://github.com/emmanuel-musau/cardano-slips).
