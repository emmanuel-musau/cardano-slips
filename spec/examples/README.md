# Examples

The payloads for every shape defined in [`../CIP-XXXX/README.md`](../CIP-XXXX/README.md).
They are part of the specification, not test rigging: an independent
implementation can run these examples and find out whether it conforms without
reading a line of our code.

One directory per shape, named for the `type` the payload declares, and the same
three buckets inside each:

```
slips-json/            (no type)        — an origin's human paths
get/                   type: "slip"     — discovery metadata
build-request/         (no type)        — the body a client POSTs
partial/               type: "partial"  — the publisher's side of a transaction
error/                 type: "error"    — a request that failed
└── valid/             MUST be accepted
    invalid/
    ├── schema/        MUST be rejected by the JSON Schema alone
    └── rule/          schema-valid, and MUST still be rejected
```

Two shapes have no `type` to name them by. `build-request/` is the only payload
here that travels *to* an endpoint rather than from one, and it is a closed
object of two fields — which is where the privacy property of Mode A actually
lives: `utxos-in-the-body.json` is the payload this protocol exists to make
unsendable, and it is rejected by the same keyword that rejects any other
undeclared member. `slips-json/` is fetched from a fixed filename rather than
returned by a negotiated endpoint, so there is nothing it could be confused
with; `absolute-api-path.json` is its equivalent case, the mapping to another
host that the grammar cannot express.

`slips-json/` carries one file outside the three buckets. `resolution.json` is a
table of rule sets, input paths and expected results: a schema proves almost
nothing about a rewriting algorithm, and the cases that separate a conforming
resolver from a plausible one — an output that must not be re-matched, an
encoded slash that must not split a segment, a trailing slash that is not
equivalent — are behaviour, not shape. It has no rejection cases, and that is
itself the point: file validation has already removed every way to express one.

`error/` is validated by two schemas rather than one. An endpoint conforms to
`slip-error-response-endpoint.schema.json`, where `code` is closed to the eight
values version 1 lets an endpoint send; a client validates against
`slip-error-response.schema.json`, where `code` is constrained only to the shape
of a code. `invalid/schema/` means *rejected by the endpoint schema* — what a
publisher is held to. Two of those payloads are still readable by a client, and
that difference is the point: see below.

## `invalid/rule` — the checks a validator cannot make

Fourteen normative rules compare values a JSON Schema cannot see at once, need
context the payload does not carry — the request URL, the network the Slip
declared, the wall clock — or judge what a string says rather than what shape it
is. A client that validates and stops is not conforming; these are the payloads
that prove it.

| Payload | Rejected because |
|---|---|
| `get/cross-origin-href.json` | `href` resolves to an origin other than the discovery URL's. Requires the request URL, which the schema never has. |
| `get/bounds-reversed.json` | `max` is less than `min`. Compares two sibling values. |
| `get/undeclared-placeholder.json` | `href` contains `{amount}` with no parameter named `amount`. |
| `get/unfilled-placeholder-parameter.json` | A parameter is declared that no placeholder references, so its value would reach nothing. |
| `error/markup-in-message.json` | `message` carries markup, which a client renders as text — so the person reads the tags. |
| `slips-json/wildcard-count-disagrees.json` | `apiPath` carries two wildcards where `pathPattern` has one. Substitution is positional, so the rule has no defined result. |
| `slips-json/wildcard-kind-disagrees.json` | The counts agree and the kinds do not — `*` on one side, `**` on the other. |
| `slips-json/duplicate-path-pattern.json` | The same `pathPattern` twice. The second rule can never be reached, which makes it a mistake about the file rather than a choice within it. |
| `build-request/address-network-disagrees.json` | A `preprod` address sent with `network: "mainnet"`. Two sibling values, and one of them encodes the answer to the other. |
| `partial/already-expired.json` | `validUntil` has passed. Needs the clock, which no schema has. |
| `partial/output-on-wrong-network.json` | A `preprod` address in an intent served by a `mainnet` Slip. Needs the network the endpoint declared at `GET`. |
| `partial/duplicate-asset.json` | One output names the same policy and asset name twice. Two quantities for one asset have no defined sum. |
| `error/internal-detail-in-message.json` | `message` names an internal host and path. Well-formed, well under the length limit, and still not something to show anyone. |
| `partial/internal-detail-in-message.json` | The same rule on the other side of the build step: a queue path and an internal hostname, in the text shown just before a signature is requested. |

The last two are the reason `message` cannot be an exception's `.message`
piped to the wire: both would pass every check a schema can make.

## `error/` — the codes, and the two payloads that prove the split

The failure codes are a closed set for an endpoint, and each of its eight
endpoint-raised codes has a payload in `valid/`. Seven codes are raised only by
a client and have none on purpose. Three name a failure of the exchange itself —
`MALFORMED_RESPONSE`, `UNSUPPORTED_VERSION`, `UNREACHABLE` — so there is no body
they could arrive in. The other four arise after a conforming response, in work
only the client can do: `INSUFFICIENT_FUNDS`, `CANNOT_BALANCE` and
`INTENT_EXPIRED` come out of balancing, and `UNSUPPORTED_BUILD_MODE` out of a
Slip that asks to be balanced by its own publisher. `WRONG_NETWORK` is raised by
both and is sendable, so it has one.

Two payloads under `invalid/schema/` are rejected by the endpoint schema and
**accepted** by the client schema, which is the only reason the two schemas
exist:

| Payload | Why it splits |
|---|---|
| `client-code-on-the-wire.json` | Sends `UNREACHABLE`, a condition only a client can observe. An endpoint may not claim it — but a client that met it anyway would still read the body and treat it as terminal, rather than reporting an unreadable response. |
| `unknown-code.json` | Invents `INSUFFICIENT_FUNDS`, the tempting one: it reads like a payment error an endpoint would raise, and an endpoint cannot possibly know it — the client balances against its own unspent outputs and the endpoint never sees them. Non-conforming, and still readable, so the publisher's `message` survives. |

Every other payload in that directory is structurally broken, and a client
rejects it too: those are not failure responses at all, and the client falls
back to classifying by HTTP status.

## Keeping it honest

`test/spec-domain-mapping.test.ts`, `test/spec-get-discovery.test.ts`,
`test/spec-post-intent.test.ts` and `test/spec-error-codes.test.ts` assert
that every file here is accounted for: each `valid/` payload validates, each
`invalid/schema/` payload is rejected by the keyword and at the location its
case names, and each `invalid/rule/` payload **passes** validation — which is
what makes it evidence that the rule has to live somewhere else. Every
`error/invalid/schema/` case also records whether a client can still read it,
and the suite fails if that column ever collapses to one value. Adding a file
without recording what it demonstrates fails the suite.

Every JSON example printed in the CIP is one of these files, matched to its
directory by the `type` it declares. The specification and these examples
cannot disagree, because the text is drawn from them.
