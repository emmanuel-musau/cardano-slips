---
CIP: "?"
Title: Endpoint-Built Transaction Requests
Category: Wallets
Status: Proposed
Authors:
    - Emmanuel Mutisya <emmanuelmutisya254@gmail.com>
Implementors: []
Solution To:
    - CPS-0016: https://github.com/cardano-foundation/CIPs/tree/master/CPS-0016
Discussions:
    - Original PR: https://github.com/cardano-foundation/CIPs/pull/?
Created: 2026-08-20
License: CC-BY-4.0
---

## Abstract

This proposal defines *Cardano Slips*: a protocol by which an HTTP endpoint
describes an on-chain intent and returns an unsigned transaction, so that an
ordinary URL can carry a specific, signable intent to wherever a person already
is — a social post, a chat message, a printed QR code.

A Slip is two HTTP methods on one endpoint. `GET` returns metadata
describing the intent and its parameters. `POST` returns a *partial
transaction* carrying only the publisher's side of it. A client resolves the
link, balances the transaction locally against the user's own unspent outputs
— the endpoint never receives them — derives the transaction's exact effects
from its body, and refuses to request a signature if those effects contradict
the intent the endpoint declared.

Because an eUTxO transaction fully determines its own effects and fee before
submission, that comparison is arithmetic over the transaction body rather than
a simulation of it. A client can therefore establish what a transaction does
without trusting its publisher, and no registry of approved publishers is
required.

This proposal defines a `slips.json` mapping from human-readable paths to
endpoints, specifies the unavailable and failure states a client must render,
and registers the `//slip` authority under [CIP-13] for platforms where a link
cannot reach a client on its own. Nothing here depends on that authority: the
protocol runs over ordinary links and the wallet interface wallets already
expose.

## Motivation: Why is this CIP necessary?

[CPS-16] asks, as its third open question, what new authorities or protocols
could be built to leverage Cardano URIs. This proposal is one answer.

Cardano has the components for shareable on-chain interactions and no standard
that joins them. [CIP-13] defines the `web+cardano:` scheme, and nine
authorities are registered under it. Four produce a transaction — payment,
stake delegation, DRep delegation and token claims — and each fixes that
transaction's shape in the URI itself, with a defined set of query parameters.
The remainder reference chain data, open a URL in a wallet's browser, or pair a
peer. Supporting a new kind of Slip therefore means writing a new CIP and
persuading every wallet to implement it, one at a time — a cost the support
matrices for `//pay`, `//drep` and `//browse` make visible.

The nearest precedent is [CIP-99], which is Active with five wallet
implementations and already has wallets send an HTTP `POST` to a project's own
server from a link. What CIP-99 does not do is return a transaction for the user
to authorise: its server builds, signs and submits the transaction itself and
pays for it, which suits a faucet and cannot express a Slip the user
initiates. Across every registered authority, either the transaction shape is
fixed in the URI or the server signs. Nothing lets a publisher express an
arbitrary intent that the user authorises.

The stakeholders are the dApps that lose users in the gap between seeing a link
and reaching a signing screen; the merchants and creators who want to be paid in
native assets without operating a checkout; the stake pool operators and
referrers whose distribution is entirely link-sharing; and the wallets, which
today must implement each new URI authority separately rather than one general
mechanism.

A protocol that returns a server-built transaction also creates a risk the
existing authorities do not carry: the user is asked to sign something a third
party constructed. [CIP-13]'s own security considerations raise the related
concern of links that misrepresent where they lead. This proposal answers both
by making client-side derivation of a transaction's effects mandatory, and a
contradiction between those effects and what the endpoint declared a hard block
on signing.

## Specification

### Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119] and [RFC 8174] when, and only when, they
appear in all capitals.

Three roles are referred to throughout:

- **Slip endpoint** — the HTTP resource that answers `GET` and `POST`.
- **Publisher** — the party operating the endpoint.
- **Client** — software that resolves a link, renders the Slip, derives the
  effects of the resulting transaction, and drives the wallet.

Every payload defined here has a JSON Schema under
[`schemas/`](./schemas), and those schemas are normative: where this document and a
schema disagree, the schema is the defect. Payloads that a conforming
implementation MUST accept, and payloads it MUST reject, are published as
test examples in [`../examples/`](../examples).

### Domain mapping

A Slip endpoint is an API path, and an API path is not what anyone wants to
share. `slips.json` puts a human path in front of one, so that the link a person
posts reads as something a person wrote.

A publisher serves it at `/slips.json`, at the root of the origin the human path
is on. It MUST set `Access-Control-Allow-Origin: *`, MUST NOT require
credentials, and SHOULD be cacheable — the same rules discovery follows, and for
the same reason: a client runs in a page on an origin the publisher does not
control, and a file the browser withholds does not exist.

The file is optional. Where an origin serves no mapping, a client MUST treat the
link as its own endpoint and `GET` it directly, which is what a publisher whose
URLs are already the endpoints wants.

`slips.json` carries no `version`. Every other shape in this protocol declares
one, and this one cannot coherently: it maps paths for a whole origin, and an
origin is free to serve a version 1 endpoint at one path and a version 2
endpoint at another. It also carries no `type`, because it is fetched from a
fixed filename rather than returned by a negotiated endpoint — there is nothing
it could be confused with.

`rules` is an array of 1–100 rules, tried in order.

| Field | Required | Type | Rule |
|---|---|---|---|
| `pathPattern` | yes | string | The human path this rule answers for. |
| `apiPath` | yes | string | The endpoint path it resolves to. MUST carry the same wildcards, of the same kinds, in the same order, as its `pathPattern`. |

**Both are path-absolute references, and that is a security property rather than
a convenience.** Neither may carry a scheme or an authority, so a rule that sent
a person to another host is not something this file can express. A protocol
where one URL stands for another, and where the second may be anywhere, is the
hijacked link [CIP-13]'s security considerations warn about — and it would
reopen exactly what [Linked actions](#linked-actions) closes by requiring every
`href` to stay on the discovery origin. A rule that must be *checked* is a rule
an implementation can forget; a grammar that cannot carry a host has nothing to
forget. The cost is real and accepted: a publisher whose endpoints live on
another host, `api.example` in front of `example`, serves the mapping from that
host or proxies to it.

**The grammar.** A path template is one or more segments, each introduced by
`/`. A segment is a literal, or `*`, or — as the final segment only — `**`.

- `*` matches exactly one non-empty segment.
- `**` matches one or more segments, and MUST NOT appear anywhere but last. A
  `**` in the middle of a pattern has two readings whenever the literal after it
  also occurs inside what it swallowed, and a specification with two readings
  has none.
- A wildcard is a whole segment. `/pay/user-*` is not a pattern.
- Dot segments are not permitted in either field, and neither is an empty one.

A client MUST reject a `slips.json` whose `apiPath` does not carry the same
wildcards, of the same kinds, in the same order, as its `pathPattern`:
substitution is positional, and a rule whose two sides disagree has no defined
result. A publisher MUST NOT declare the same `pathPattern` twice — the second
rule can never be reached, so it is a mistake about the file rather than a
choice within it.

**Resolution.** Given the path of a link and the rules, a client:

1. Separates the query string, which takes no part in matching.
2. Removes dot segments from the path, per [RFC 3986] §5.2.4.
3. Tries each rule in order, comparing segments as they appear in the path —
   case-sensitively, without decoding them, and without treating a trailing
   slash as equivalent to its absence.
4. On the first rule that matches, substitutes the captured segments into
   `apiPath` in order, still encoded as they arrived, and appends the query.
5. Where no rule matches, uses the path unchanged.

**A client MUST NOT match the result against the rules again.** Resolution is a
single substitution. Iterating it would make a loop expressible in a file no
validator could reject, and it would let one rule's output be silently rewritten
by another rule its author never considered.

Because segments are compared as they arrive, an encoded `/` stays inside the
segment that carries it: `%2F` never splits a path into two. A client that
decoded before matching would let a crafted link reach a rule the publisher
wrote for something else.

**A mapping that cannot be read is not a mapping that is absent.** Where
`/slips.json` answers `404` or `410`, the origin has no mapping and the link is
its own endpoint. Where the fetch fails any other way — a timeout, a `5xx`, a
refused cross-origin request — a client MUST NOT treat it as absent, and MUST
fail with `UNREACHABLE`: it cannot tell an origin with no mapping from one whose
mapping it failed to read, and guessing sends the person to a human path that
was never meant to answer. A file that arrives and does not satisfy the schema
above is `MALFORMED_RESPONSE`, and a client MUST NOT fall back to the human path
in that case either.

**Worked example.** A pool operator shares
`https://linktap.example/delegate/POOL1`. The client fetches
`https://linktap.example/slips.json`, finds the single rule above, matches
`/delegate/POOL1` against `/delegate/*`, captures `POOL1`, and issues its `GET`
to `https://linktap.example/api/slips/delegate/POOL1`. Everything after that —
discovery, the build request, balancing — happens against the resolved URL. The
link that was shared never appears again, and the person who shared it never had
to see the one that does the work.

```http
GET /slips.json HTTP/1.1
Host: linktap.example
Accept: application/json
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=300

{
  "rules": [
    {
      "pathPattern": "/delegate/*",
      "apiPath": "/api/slips/delegate/*"
    }
  ]
}
```

### The `//slip` URI authority

Everything specified in this document happens over ordinary `https:` links. A
Slip is a URL; a client fetches it, and neither the person sharing it nor the
person opening it needs anything they do not already have. **No requirement in
this document depends on the authority registered here, and a conforming
implementation never has to parse a `web+cardano:` URI at all.**

What the authority is for is the case where a link cannot reach a client:
a phone browser with no wallet connection to offer, a QR code scanned by a
camera that hands what it read straight to a wallet. [CIP-13] defines the
`web+cardano:` scheme for exactly that hand-off, and [CPS-16] requires every
extension of it to register a unique authority. This registers `slip`.

```
web+cardano://slip/v1?uri=<percent-encoded absolute https URL of the Slip>
```

```
web+cardano://slip/v1?uri=https%3A%2F%2Flinktap.example%2Fdelegate%2FPOOL1
```

The grammar is [CIP-158]'s, which is Active and implemented: a fixed authority
token, a version as the first path segment, and the payload as a percent-encoded
query value. Nothing here is new, and that is deliberate — a handler that already
parses `web+cardano://browse/v1?uri=...` parses this by changing one token.

- **The authority token is fixed, and a variable MUST NOT follow `//`.** What
  follows `//` is the URI authority under [RFC 3986] §3.2, so a handler reading a
  value there is reading it as a host. The `web+cardano:` family paid for this
  rule once already: one wallet shipped `web+cardano:<address>` and another
  shipped `web+cardano://<address>`, and payment links did not work across both
  for a year.
- **The version is in the path from the first release.** `/v1` is the major
  version of this document, and it carries the same number as `version` in every
  response. A URI whose path segment names a major version the handler does not
  implement MUST be refused, and MUST NOT be fetched.
- **`uri` is REQUIRED, and this version defines no other query parameter.** A
  handler MUST reject a URI carrying one, for the reason every shape in this
  document rejects an undeclared member: it is either a version the handler has
  not been told about or a payload it has misidentified.
- **The value MUST be a single absolute `https:` URL, percent-encoded.** A
  handler MUST refuse any other scheme, and MUST NOT accept a relative reference
  — there is nothing here for one to be relative to.

**A handler resolves the target exactly as any other client resolves a link.**
The URI carries a link and confers nothing on it: `slips.json` still applies,
discovery still applies, the effects are still derived from the transaction body,
and the comparison still blocks the signature where they disagree. A handler
that treated a Slip as pre-approved because it arrived in a URI would have
inverted the protocol —
the URI is the one part of it an attacker can write in full, into a QR code, onto
a poster.

**The origin is still what the person is dealing with.** A `web+cardano:` URI
hides the URL it carries behind percent-encoding, so a handler MUST render the
resolved origin under [Origin spoofing](#origin-spoofing) before anything can be
signed, and MUST NOT render any part of the URI in its place.

Registration is the whole of what this section asks of a wallet, and it asks it
of no wallet in particular. Where a wallet implements the authority, a shared
link reaches it directly. Where none does — which is what [CIP-13]'s record
since 2020 should lead anyone to plan for — a person on a phone opens the same
link in a browser, or reaches a wallet's in-app browser through [CIP-158]
`//browse`, and the flow this document specifies runs there unchanged over
CIP-30. That is why no criterion in [Path to Active](#acceptance-criteria) asks
a wallet to implement this authority, and why none may be added that does.

### Discovery

A client discovers a Slip by issuing `GET` to the Slip endpoint.

The request carries no body. A client MUST NOT send credentials — no cookies,
no `Authorization` header — and an endpoint MUST NOT require them in order to
describe itself. Discovery is anonymous by construction: the same bytes are
returned to the person who clicked the link and to the crawler that generated
its preview, and an endpoint therefore learns nothing about a person from the
fact that a card was rendered.

```http
GET /api/slips/pay/corner-store HTTP/1.1
Host: linktap.example
Accept: application/json
```

A successful response MUST have status `200`, MUST set `Content-Type` to
`application/json`, and MUST set `Access-Control-Allow-Origin: *`. A client
executes inside a page on an origin the publisher does not control, so an
endpoint without that header is unreachable by every client. Preflight
requirements are specified with `POST`.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=60
```

The response MUST NOT vary by requester identity, and SHOULD be cacheable.

A Slip that cannot currently be used MUST still answer `200` with a complete
body and `disabled` set, as described under [Unavailable
actions](#unavailable-actions). Reporting unavailability with a non-2xx status
is non-conforming: it turns a state the client can render into a failure the
person meets only after committing to the action. Non-2xx responses signal that
discovery itself failed.

### The discovery response

The response body is a single JSON object.

| Field | Required | Type | Rule |
|---|---|---|---|
| `type` | yes | string | MUST be `"slip"`. Discriminates discovery metadata from the partial intent `POST` returns. |
| `version` | yes | string | The major version of this protocol the response speaks, in decimal, with no leading zero. `"1"` for this document. |
| `title` | yes | string | What the Slip does, in the publisher's own words. 1–120 characters. |
| `description` | yes | string | Plain text, 1–500 characters. MUST NOT contain markup; a client MUST render it as text. |
| `icon` | yes | string | Absolute `https:` URL of a square image. `data:` URIs MUST NOT be used — the same image is fetched by link unfurlers that never execute the publisher's code. |
| `label` | yes | string | The Slip's call to action, 1–48 characters. Labels the single button when `links` is absent; where `links` is present a client MUST render the linked actions and use `label` only where one string is all that fits, such as a link preview. |
| `network` | yes | string | One of `mainnet`, `preprod`, `preview`. A client MUST NOT `POST` while the connected wallet is on a different network. |
| `build` | no | string | Who balances the transaction: `local` or `server`. Absent means `local`, which is the only mode version 1 implements. See [Build modes](#build-modes). |
| `links` | no | object | Carries `actions`, an array of 1–3 [linked actions](#linked-actions). When absent, the Slip is a single button labelled `label` whose target is the discovery URL itself. |
| `disabled` | no | boolean | When `true`, nothing in this response may be signed. See [Unavailable actions](#unavailable-actions). |
| `reason` | no | object | Why the Slip is unavailable. Valid only alongside `disabled`. |

A client MUST reject a response carrying a member not defined above. An
undefined member is either a newer version the client has not been told about
or a payload it has misidentified, and both are safer refused than rendered.

`version` is matched as a decimal string rather than pinned to `"1"`, so that a
client meeting a future major version can tell an unsupported protocol from a
malformed response. What it does about that is specified under [Protocol
versioning](#protocol-versioning).

```json
{
  "type": "slip",
  "version": "1",
  "network": "mainnet",
  "icon": "https://linktap.example/i/corner-store.png",
  "title": "Pay 12.00 USDM to Corner Store",
  "description": "One payment to the shop's address. Nothing is stored, no account is created.",
  "label": "Pay 12.00 USDM"
}
```

Every field above describes the Slip; none of it describes the person, and
nothing in discovery is a promise about the transaction. `title` and
`description` are claims by the publisher, checked later against the effects a
client derives from the transaction body itself.

The `network` field is named rather than numeric because a CIP-30 wallet
reports only `0` or `1`, which cannot separate `preprod` from `preview`. An
endpoint serving more than one network MUST publish one URL per network.

### Linked actions

`links.actions` replaces the single button with up to three, each a distinct
action against the same publisher.

| Field | Required | Type | Rule |
|---|---|---|---|
| `label` | yes | string | Button text, 1–64 characters. MAY contain placeholders drawn from this action's `parameters`. |
| `href` | yes | string | The `POST` target: a path-absolute reference, or an absolute `https:` URL. MAY contain placeholders. |
| `parameters` | no | array | 1–8 [parameters](#parameters) whose values complete `href`. |
| `disabled` | no | boolean | When `true`, this option alone cannot be used. |
| `reason` | no | object | Why this option is unavailable. Valid only alongside `disabled`. |

A client MUST resolve `href` against the discovery URL, and MUST reject the
response unless every resolved target has the same origin as the discovery URL.
A Slip that hands a person to a third party for the transaction is
indistinguishable from a hijacked link, and [CIP-13]'s own security
considerations raise exactly that concern. Where a publisher wants a human
URL in front of a technical endpoint,
[`slips.json`](#domain-mapping) is the sanctioned indirection.

The cap of three is a property of the shape, not of any client: a publisher
offering more choices expresses them as a `select` parameter, which stays
legible at any width and keeps a card from becoming a menu.

```json
{
  "type": "slip",
  "version": "1",
  "network": "mainnet",
  "icon": "https://fund.linktap.example/i/community-fund.png",
  "title": "Contribute to the Community Fund",
  "description": "Pick an amount and a token. The fund's address is the only recipient.",
  "label": "Contribute",
  "links": {
    "actions": [
      { "label": "Contribute 25 USDM", "href": "/api/slips/fund/community?amount=25&token=usdm" },
      { "label": "Contribute 100 USDM", "href": "/api/slips/fund/community?amount=100&token=usdm" },
      {
        "label": "Contribute {amount} {token}",
        "href": "/api/slips/fund/community?amount={amount}&token={token}",
        "parameters": [
          { "name": "amount", "label": "Amount", "type": "number", "min": 1, "max": 500, "required": true },
          {
            "name": "token",
            "label": "Token",
            "type": "select",
            "required": true,
            "options": [
              { "label": "USDM", "value": "usdm" },
              { "label": "USDCx", "value": "usdcx" }
            ]
          }
        ]
      }
    ]
  }
}
```

### Parameters

A parameter describes one field of a form the client generates. It describes
input only: it is a hint about what to collect, never a guarantee about what
arrives, and an endpoint MUST validate every value it receives regardless of
what it declared.

| Field | Required | Type | Rule |
|---|---|---|---|
| `name` | yes | string | Matches the placeholder it fills. Begins with a letter, then letters, digits or `_`, up to 32 characters. MUST be unique within its action. |
| `label` | yes | string | Field label, 1–48 characters. |
| `type` | yes | string | One of `text`, `number`, `select`. |
| `required` | no | boolean | Defaults to `false`. A client MUST NOT `POST` while a required parameter is empty. |
| `min` | no | number | For `number`, the smallest accepted value. For `text`, the smallest accepted length, as a non-negative integer. MUST NOT appear on `select`. |
| `max` | no | number | The corresponding upper bound, and MUST NOT be less than `min`. MUST NOT appear on `select`. |
| `options` | no | array | 1–20 `{ label, value }` pairs. REQUIRED on `select`, and MUST NOT appear on any other type. |

A client MUST enforce `required`, `min` and `max` before sending a request, and
MUST show the bounds alongside the field rather than only on failure.

The three types are the set whose meaning is unambiguous across every client
this protocol expects. Types carrying Cardano-specific validation — addresses,
asset amounts with decimals — are deliberately absent from version 1 rather
than specified before there is an implementation to check them against.

### Templated references

`label` and `href` MAY contain placeholders of the form `{name}`, where `name`
matches a parameter of the same linked action.

- A client MUST substitute the collected value for each placeholder.
- A value substituted into `href` MUST be percent-encoded per [RFC 3986].
- A placeholder in `label` is substituted verbatim, for display only.
- A response containing a placeholder with no matching parameter MUST be
  rejected. Braces are never literal.
- A response declaring a parameter that no placeholder references MUST be
  rejected. A collected value that reaches nothing is a defect in the endpoint,
  not an optional extra.

A linked action without `parameters` is submitted as soon as it is chosen.

### Unavailable actions

`disabled` appears at two levels, and its accompanying `reason` explains it.

- `disabled` at the top level closes the entire action.
- `disabled` on a linked action closes that option alone.
- Where both appear, the top level wins. A linked action MUST NOT be treated as
  usable because it carries `disabled: false` under a disabled response.
- `disabled: true` MUST be accompanied by `reason` at the same level. A control
  a person cannot use, with no reason given, leaves them unable to distinguish a
  closed action from a broken one.
- `reason` MUST NOT appear without `disabled: true`. It states why something is
  unavailable and carries no other meaning.

A client MUST render a disabled action, and MUST render its `reason.message` in
place of the control it disables. A client MUST NOT hide a disabled action or
omit a disabled option: a shared link is seen by many people at once, and a
client that silently drops part of it shows different people different actions
with no way for the publisher to know.

`reason` carries a REQUIRED human-readable `message` of 1–300 characters, and an
OPTIONAL machine-readable `code` naming the unavailability. A `code` here is not
a failure code: the request succeeded, and the response is describing the state
of the action rather than reporting that something went wrong. Codes for
requests that genuinely fail are specified under [Failure
responses](#failure-responses).

```json
{
  "type": "slip",
  "version": "1",
  "network": "mainnet",
  "icon": "https://linktap.example/i/community-pool.svg",
  "title": "Delegate to Community Stake Pool",
  "description": "Stake your ADA. Funds never leave your wallet.",
  "label": "Delegate",
  "disabled": true,
  "reason": { "message": "This campaign closed on 12 August. Nothing can be signed from this link." }
}
```

```json
{
  "type": "slip",
  "version": "1",
  "network": "preprod",
  "icon": "https://linktap.example/i/builders-workshop.png",
  "title": "Reserve a seat at the builders workshop",
  "description": "One payment reserves one seat. Seats are released in tiers.",
  "label": "Reserve a seat",
  "links": {
    "actions": [
      { "label": "General seat — 25 USDM", "href": "/api/slips/workshop/reserve?tier=general" },
      {
        "label": "Front row — 75 USDM",
        "href": "/api/slips/workshop/reserve?tier=front",
        "disabled": true,
        "reason": { "message": "Front row is sold out. General seats are still available." }
      }
    ]
  }
}
```

### Building the transaction

A client turns a Slip into a transaction by issuing `POST` to the target it
resolved at discovery: the `href` of the linked action a person chose, with
every placeholder substituted, or the discovery URL itself where the Slip
declared no `links`.

The request body is a single JSON object.

| Field | Required | Type | Rule |
|---|---|---|---|
| `changeAddress` | yes | string | A bech32 payment address of the connected wallet, per [CIP-19], to which the client returns change. An endpoint MAY address outputs to it. |
| `network` | yes | string | One of `mainnet`, `preprod`, `preview`. MUST be the network the connected wallet reports. |

A client MUST NOT send any other member and an endpoint MUST reject a body
carrying one. Those two fields are the whole of what a Slip endpoint learns
about a person: one address, which they disclose to a counterparty every time
they transact anyway, and the network it is on. A client MUST NOT send its
unspent outputs and an endpoint MUST NOT ask for them — that is the whole of
[Balancing](#balancing), and it is what this shape exists to make structural
rather than promised.

The request carries no `version`, because one URL speaks one major version and
there is nothing to negotiate; see [Protocol versioning](#protocol-versioning).
Parameter values are not in the body either: they were substituted into `href`
before the request was made, so an endpoint reads them from its own URL.

**Three statements of network have to agree.** An endpoint MUST reject with
`WRONG_NETWORK` unless the network the Slip declared at `GET`, the `network` the
request states, and the network its own address encodes are the same. Each is
observable to the endpoint and each can be wrong on its own — a stale card, a
wallet switched between discovery and submission, an address pasted from another
network — and a transaction built across two of them is refused by the ledger
long after the person believed it was sent.

```http
POST /api/slips/pay/corner-store HTTP/1.1
Host: linktap.example
Content-Type: application/json
Accept: application/json

{
  "changeAddress": "addr1qxhnsjcej3c36wkl00plhu94pt5x0t4jr8wnnzxuuwwyjynn4lleg4u9dpmgh74jap9ef7587khxr79r430d4gkalfwsl0vysa",
  "network": "mainnet"
}
```

A successful response MUST have status `200`, MUST set `Content-Type` to
`application/json`, and MUST set `Access-Control-Allow-Origin: *`. It MUST NOT
be cached and MUST set `Cache-Control: no-store`. A partial intent is built for
one person, against one address, and expires; a cached one is a stale
transaction served to whoever asks next.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Cache-Control: no-store
```

**Preflight is not optional here.** A JSON body makes this request non-simple,
so a browser sends `OPTIONS` first and the `POST` never leaves the machine
unless that is answered. An endpoint MUST answer `OPTIONS` on every Slip URL
with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST,
OPTIONS` and `Access-Control-Allow-Headers: Content-Type`, and SHOULD set
`Access-Control-Max-Age`. As at discovery, an endpoint MUST NOT require
credentials and MUST NOT set `Access-Control-Allow-Credentials`.

**A `POST` commits nothing.** It returns a transaction and signs nothing, so an
endpoint MUST NOT treat it as a purchase, and MUST NOT move state a person
cannot then release — a seat held by a request the person never signed is a seat
lost to everyone. Where a publisher genuinely needs to hold something, the hold
is bounded by `validUntil` and released when it passes.

#### Build modes

`build` in the discovery response names who balances the transaction. Version 1
defines two values and implements one.

- `local` — the endpoint returns its own side of the intent and the client
  balances it against unspent outputs the endpoint never sees. Absent means
  `local`, and everything in this document describes it.
- `server` — the client sends its unspent outputs and the endpoint returns a
  complete transaction. Reserved. Version 1 does not define that request, and no
  client implements it.

A client MUST NOT `POST` to a Slip declaring `build: "server"`. It MUST render
the card, MUST NOT present a control that can be pressed, and MUST fail with
`UNSUPPORTED_BUILD_MODE`, so that a person meets a Slip this client cannot build
rather than one that appears broken.

The value is reserved in the schema rather than in words alone. A client MUST
reject an undefined member, so an endpoint that declared a mode this version had
not defined would be malformed rather than unsupported, and the mode that
eventually ships would cost a major version instead of a field. What a
server-balanced mode hands an endpoint — the person's whole unspent output set,
and with it a picture of everything they hold — is the reason it is not in
version 1 and the reason a client will warn before using it when it is.

### The partial intent

A successful `POST` returns the publisher's side of a transaction, and nothing
that the ledger or the wallet determines.

| Field | Required | Type | Rule |
|---|---|---|---|
| `type` | yes | string | MUST be `"partial"`. Discriminates a partial intent from discovery metadata and from a failure. |
| `version` | yes | string | The major version of this protocol the response speaks, under the same rule as discovery. |
| `intent` | yes | object | What the transaction is asked to do. |
| `message` | no | string | Plain text addressed to the person, 1–300 characters. MUST NOT contain markup and MUST NOT carry internal detail — no queue names, no upstream hosts, no identifiers of the publisher's own systems. |

`message` is a claim, not a description of the transaction. A client MUST render
it alongside the effects it derived and MUST NOT render it in place of them:
a sentence that reached the person instead of the arithmetic is the failure this
protocol is built to prevent.

The `intent` object carries the transaction's parts.

| Field | Required | Type | Rule |
|---|---|---|---|
| `outputs` | no | array | 1–16 [outputs](#outputs) the transaction pays. |
| `certificates` | no | array | 1–8 [certificates](#certificates) it carries. |
| `withdrawRewards` | no | boolean | When `true`, the transaction withdraws the whole balance of the wallet's own reward account. See [Rewards](#rewards). |
| `validUntil` | yes | string | An [RFC 3339] instant in UTC, to the second, with no offset and no fraction. After it, the intent is stale. |

An intent MUST carry at least one of `outputs`, `certificates` or
`withdrawRewards`, and a client MUST reject one that carries none: a transaction
that does nothing still costs a fee, and asking a person to pay one for nothing
is either a defect or an attack.

**Every quantity is an integer count of base units, written in decimal, as a
string.** Lovelace for ADA; the raw on-chain quantity for a native asset. No
field in this document is decimals-adjusted, and there is no field in which a
publisher may state how many decimals an asset has. A client MUST NOT infer
decimals from a Slip, and MUST compare declared against derived in base units.

That rule is short and it is the one this ecosystem has paid for most often:
mishandled decimals on an amount has shipped in production wallets more than any
other defect in the `web+cardano:` family. Two things follow from it. Quantities
are strings because a JSON number cannot carry them — a large asset quantity
does not survive a double, and `12.5` is not a count of anything. And decimals
are absent because a publisher able to state them could declare 1200 base units,
display them as `0.0012`, and pass a comparison of 1200 against 1200 while the
person read a figure a millionth of the one they authorised. Where a client can
resolve an asset's decimals from on-chain metadata it MAY use them for display;
where it cannot, it MUST show base units rather than guess.

**An endpoint declares what it chooses, and nothing that is determined for it.**
The fee, the deposit a certificate carries, the stake credential a certificate
acts on, the balance of a reward account, the key hash behind a signature: each
is fixed by the ledger, by a protocol parameter, or by the wallet, and none of
them appears in this shape. There is therefore no field in which an endpoint can
state one wrongly. A declared value that is right is redundant, and one that is
wrong is either a transaction the ledger refuses or a figure shown to a person
who had no way to check it.

```json
{
  "type": "partial",
  "version": "1",
  "intent": {
    "outputs": [
      {
        "address": "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us",
        "lovelace": "12000000"
      }
    ],
    "validUntil": "2026-08-22T19:40:00Z"
  },
  "message": "One payment to the shop's address."
}
```

#### Outputs

An output is one payment the publisher asks the transaction to make.

| Field | Required | Type | Rule |
|---|---|---|---|
| `address` | yes | string | A bech32 payment address per [CIP-19]. |
| `lovelace` | yes | string | Base units of ADA. A floor, not a fixed amount — see below. |
| `assets` | no | array | 1–16 native asset quantities travelling in this output. |

| Field | Required | Type | Rule |
|---|---|---|---|
| `policyId` | yes | string | The minting policy id, 28 bytes as lowercase hex. |
| `assetName` | yes | string | The on-chain asset name as lowercase hex, up to 32 bytes. An empty string is a policy's unnamed asset. Never a ticker: a ticker is a rendering of a name, not the name. |
| `quantity` | yes | string | Base units, at least 1. |

An output MUST NOT name the same asset twice — one `policyId` and `assetName`
pair appears at most once per output — because two quantities for one asset have
no defined sum here and the transaction that results would encode whichever the
implementation happened to keep.

Every address in the intent MUST encode the Slip's own network, and a client
MUST reject an intent where one does not. The endpoint knows the network: it
declared it at `GET` and was sent it again with the request.

**Declared lovelace is a floor.** The ledger requires every output to carry a
minimum quantity of ADA that depends on the output's own size and on a protocol
parameter, so an endpoint sending native assets often cannot know what the
output will cost to make. Where the declared amount is below that minimum, a
client MUST raise it to the minimum, and MUST show the difference to the person
as an effect of its own rather than folding it into the declared amount. An
endpoint asking for the minimum and no more declares `"0"`.

Without that rule the alternatives are both worse: an intent whose token payment
cannot be built at all, or a client quietly spending more of a person's ADA than
anything on screen accounted for. Naming it here is also what lets the effects
comparison stay strict — the difference is a known adjustment with a stated
cause, not an unexplained divergence.

```json
{
  "type": "partial",
  "version": "1",
  "intent": {
    "outputs": [
      {
        "address": "addr1qxettqndzx5pmwkaxydp0lpaffxsnfgkgwx6afzn43w9wd7pzq7lsck6w56xu7yz5tsypql5gpcw20s5csf9jlr7mkjsq9l5us",
        "lovelace": "0",
        "assets": [
          {
            "policyId": "1ec7e2a7162b3aab4a428333409f8ba653c9e37996531ebf09f40128",
            "assetName": "5553444d",
            "quantity": "12000000"
          }
        ]
      }
    ],
    "validUntil": "2026-08-22T19:40:00Z"
  },
  "message": "12.00 USDM to the shop. The ADA travelling with it is the ledger's minimum and comes back to you as change on your next spend."
}
```

#### Certificates

A certificate acts on the connected wallet's own stake credential.

| Field | Required | Type | Rule |
|---|---|---|---|
| `type` | yes | string | One of `stakeRegistration`, `stakeDeregistration`, `stakeDelegation`, `voteDelegation`. |
| `poolId` | no | string | A bech32 pool id. REQUIRED by `stakeDelegation`, and MUST NOT appear on any other type. |
| `drep` | no | string | A bech32 DRep id per [CIP-129], or `abstain`, or `noConfidence`. REQUIRED by `voteDelegation`, and MUST NOT appear on any other type. |

The credential itself is absent, and so is the deposit. An endpoint holds one
address and has no business naming a person's own credential back at them; the
client supplies it, and an endpoint therefore never learns which credential a
certificate ended up naming. A registration deposit and a deregistration refund
are protocol parameters the ledger applies whatever anyone declared, so the
client supplies those too and renders them among the derived effects.

What remains is exactly the part the publisher does know and does choose: which
pool, or which DRep.

```json
{
  "type": "partial",
  "version": "1",
  "intent": {
    "certificates": [
      {
        "type": "stakeDelegation",
        "poolId": "pool1ayfz9ymjutjzx0a33q8tq6zrn8lj3ckmzp69c9vxk8kyxylly5y"
      }
    ],
    "validUntil": "2026-08-22T19:40:00Z"
  },
  "message": "Delegate to the Community Stake Pool. Your ADA never leaves your wallet."
}
```

#### Rewards

`withdrawRewards` carries no amount, because a withdrawal must take the whole
balance of a reward account and only the client can know what that balance is.
The endpoint declares that a withdrawal happens; the client resolves the account
from its own credential, reads the balance, and renders the exact figure it
withdrew.

#### Required signers, and why there are none

A transaction body can name key hashes whose signatures it requires, and a
version of this intent could let a publisher ask for them. This one does not,
because in the mode specified here nothing could read them.

Required signers exist so that a script can see who signed. A script runs when a
transaction spends from a script address, mints, withdraws from a script stake
credential, or carries a script certificate. A Mode A transaction does none of
those: its inputs are selected by the client from an ordinary wallet, this
version defines no mint, and the withdrawal and certificates above act on the
wallet's own key-based stake credential. Nor can a later transaction read this
one's signers — they are visible only inside the transaction that carries them.

What remains is a field that obliges the ledger to demand a witness, costs the
person the bytes and the fee to carry it, and tells no one anything they could
not read from the transaction's own inputs. A publisher reconciling payments
off-chain has the witness set and the input addresses already.

The field returns when something can act on it: script actions, or the
server-balanced mode reserved under [Build modes](#build-modes). Adding it then
is a new major version, which is the cost this document accepts everywhere in
exchange for a client that rejects members it does not understand.

### Balancing

The client completes the transaction. It selects inputs from the connected
wallet's unspent outputs, adds the outputs, certificates and withdrawal the
intent declared, computes the fee, and returns the remainder to
`changeAddress`.

**A client MUST NOT send the user's unspent outputs to a Slip endpoint, and MUST
NOT send anything else describing what the wallet holds.** In this version there
is no request in which it could: the build request is a closed object of two
fields. The privacy property is therefore structural rather than a policy — an
endpoint learns that someone at a given address wanted a given intent, and never
what they hold.

**A client MUST NOT set a validity interval ending after `validUntil`.** It
SHOULD set a shorter one where its own rebuild path allows, because a
transaction that stays submittable for hours can be submitted hours later, by
anyone who obtained it, against a fee market and a UTxO set that have both
moved. A client MUST reject an intent carrying a `validUntil` that has already
passed, and MUST NOT ask for a signature over a transaction whose interval has
expired while the person was reading it — it rebuilds by repeating the `POST`
and derives the effects again before prompting.

Three conditions belong to this step, and each is a client condition in the
vocabulary of [Failure responses](#failure-responses) — none of them travels
over HTTP, because none is something an endpoint can observe:

- `INSUFFICIENT_FUNDS`, when the wallet's unspent outputs cannot cover the
  intent, the minimum ADA its outputs require, and the fee. It is in the request
  class: the person can act, and the same request will succeed once they have.
- `CANNOT_BALANCE`, when the intent cannot be built into a valid transaction for
  any other reason — a size limit, a count of outputs no selection satisfies.
- `INTENT_EXPIRED`, when `validUntil` has passed. It is transient: a fresh
  `POST` returns a fresh intent, which is exactly what the client's rebuild path
  does.

An endpoint MUST NOT send any of the three. It cannot see a wallet's unspent
outputs, so it cannot know that they are insufficient — a code claiming
otherwise is a non-conforming endpoint asserting a fact it has no access to.

What the client holds at the end of this step is a complete, unsigned
transaction, and the intent above is the declaration it will be judged against.
The metadata a Slip showed at discovery is words and is never that declaration:
a claim in a `title` cannot be compared with arithmetic, and a client MUST NOT
treat one as though it had been.

### Deriving the effects

A client MUST derive, from the bytes of the transaction it is about to ask a
person to sign, what that transaction does. It MUST do so before every signature
request, including the one that follows a rebuild, and it MUST derive from the
transaction alone — nothing an endpoint said takes part in the arithmetic.

| Derived | What it is |
|---|---|
| `ada` | The net lovelace delta across the addresses the wallet controls: the value of the inputs the body spends, less the value of the outputs that return to it. |
| `assets` | The same net delta, per `policyId` and `assetName` pair. |
| `fee` | The fee the body states, exactly. |
| `outputs` | Every output the body pays, with its address, its lovelace, its assets, and whether the wallet controls the address. |
| `certificates` | Every certificate, with the type, the pool or DRep it names, the stake credential it acts on, and the deposit or refund the ledger applies to it. |
| `withdrawals` | Every withdrawal, with its reward account and its amount. |
| `mint` | Every asset the transaction creates or destroys, signed. |
| `validFrom`, `validUntil` | The body's validity interval, converted to wall-clock instants. |

**The derivation takes four terms, and none of them is a lookup.** A client MUST
supply each as an argument:

- **the transaction bytes**, as it will submit them;
- **the value of every input the body spends.** A body carries references to its
  inputs, not their contents, and a net delta is unobtainable without them. In
  the mode specified here the client selected those inputs from its own wallet,
  so it holds their values already.
- **the addresses the wallet controls**, including its reward account;
- **the protocol parameters in force** — the minimum-fee coefficients, the
  per-byte cost that fixes an output's minimum ADA, the stake deposit and its
  refund, and the mapping from slot to wall-clock time.

A client MUST NOT fetch any of them while deriving. The derivation is the last
thing that stands between a person and a signature, and one that reaches the
network mid-flight can be made slow, made to fail, or made to answer wrongly by
whoever is in a position to answer. Everything it needs is known before it
starts, so it is given what it needs and computes; it never asks.

**Whose addresses.** An address is the user's when the connected wallet reports
it — used, unused, change, and the reward account. A client MUST treat an
address it cannot confirm as the wallet's as though it belonged to someone else.
Wallets answer this question incompletely: used addresses arrive a page at a
time, and unused addresses past the gap are not reported at all. Erring in this
direction overstates what leaves the wallet and understates what returns, so the
person is shown a transaction no better than the one they are signing. Erring in
the other direction would hide a payment to a stranger by mistaking it for
change.

**A client MUST render the derived effects, and MUST NOT render the endpoint's
words in their place.** At minimum: the net ADA delta, the fee, each asset
delta, each certificate with the pool or DRep it names, the amount of any
withdrawal, any deposit or refund shown separately from what is spent, and the
wall-clock expiry. A deposit is not a cost — it comes back — and showing it as
one is wrong, while leaving it out of what a person is about to part with is
worse.

### The comparison

The intent is the declaration. A `title`, a `description` and a `message` are
words a publisher chose, and this document never compares them with anything;
what the endpoint declared in the intent it returned is what the transaction is
held to.

Every derived effect MUST fall into one of two sets, and a client MUST block the
signature unless every one of them does:

1. **Declared** — the intent asked for it, and it matches under the rules below.
2. **Supplied** — it is one of the adjustments this document names as the
   client's own: the fee, a deposit or refund the ledger fixes, the raise of an
   output to the ledger's minimum ADA, and change returning to `changeAddress`.

There is no third set. An effect that is neither declared nor supplied is a
mismatch, whether or not this document has a name for it — which is the property
that matters, because the effects worth hiding are the ones nobody thought to
name.

**The comparison is exact, and admits no tolerance anywhere.** Both sides are
integer counts of base units, so both sides are integers; a comparison that
allows a margin allows an attacker who works inside the margin, and the margins
that get proposed — a few lovelace, a percent of the fee — are worth more than
the transactions this protocol is for. What might otherwise be called a
tolerance is set 2 above: a closed list of adjustments, each with a stated cause
and an exact value the client can compute.

Each rule below names the reason a client reports when it fails. The reasons are
a vocabulary for explaining a block to a person; the failure itself is always
[`EFFECTS_MISMATCH`](#failure-responses).

#### Matching the outputs

Matching runs by address, because an address is what a person recognises and
what determines who ends up holding the value.

**Each declared output has exactly one permitted lovelace amount**: the amount
declared, or the ledger's minimum for that output as encoded where the declared
amount is below it. That is the floor rule from [Outputs](#outputs) stated as an
equality — the raise has a computable value, so it never widens what the
comparison accepts.

For every address the intent declares, all three MUST hold:

- **Count.** The number of outputs the body pays to it equals the number the
  intent declared. Reported as `output.missing` where the body pays fewer and
  `output.undeclared` where it pays more.
- **Lovelace.** The total the body pays to it equals the sum of the permitted
  amounts. Reported as `output.lovelace`.
- **Assets.** For every asset named by either side, the total quantity the body
  pays to it equals the total the intent declared. Reported as `output.assets`.

Where the counts differ, the totals at that address are not compared: one
difference explains the other, and two reports of the same fact tell a person
less than one.

**Every body output paying an address the intent does not declare MUST pay an
address the wallet controls**, and is change. There may be several of them, and
they need not all pay the same address. Reported as `output.undeclared`, this is
the rule that closes the whole class: a payment to a stranger that no
declaration accounts for cannot be built into a transaction this gate passes.

A client MUST NOT return change to an address the intent declares. Sending the
remainder back to an address that is also a declared recipient would make the
count and the totals at that address unattributable — some of what arrives there
was asked for and some of it is the person's own money coming home — and a
comparison that cannot separate the two is a comparison an endpoint can hide
behind. A client that meets this after building MUST rebuild to another address
it controls.

#### Matching the certificates

The body's certificates MUST be the certificates the intent declared: the same
number, of the same types, in the same order, each naming the same `poolId` or
`drep`. Reported as `certificate.missing`, `certificate.undeclared`,
`certificate.target` and `certificate.order`.

Order is part of the comparison because the ledger applies certificates in
order: a registration that follows the delegation depending on it is a different
transaction from one that precedes it, and only one of the two does what the
person was shown.

A client reports the difference by the first of these that applies, so that what
it says is what happened rather than every rule the difference violated:

1. The counts differ — `certificate.missing` where the body carries fewer,
   `certificate.undeclared` where it carries more.
2. The types agree position by position, and a pool or a DRep does not —
   `certificate.target`.
3. The same certificates are all present in another order —
   `certificate.order`.
4. Otherwise the two sets differ in their contents, reported as
   `certificate.missing` and `certificate.undeclared` together.

**Every certificate MUST act on a stake credential the connected wallet
controls**, reported as `certificate.credential`. This version has no field in
which an endpoint could name a credential, so a certificate acting on someone
else's is not a claim that failed to match — it is an effect nothing could have
declared.

The deposit a registration carries and the refund a deregistration returns are
supplied, never compared. The ledger fixes both from a protocol parameter
whatever anyone declared, and [Certificates](#certificates) is where this
document says an endpoint may not state them.

#### Matching the withdrawal

Where the intent set `withdrawRewards` to `true`, the body MUST carry exactly
one withdrawal and it MUST be from the wallet's own reward account. Where the
intent did not, the body MUST carry none. Reported as `withdrawal.missing`,
`withdrawal.undeclared` and `withdrawal.account`.

The amount is not compared, because nothing declares it and the ledger admits
only one value: the whole balance of the account. The client renders the figure
it withdrew, as [Rewards](#rewards) requires.

#### Effects nothing can declare

Version 1 defines no field for a mint or a burn, a reference input, collateral,
a required signer, a vote, a governance proposal, a treasury donation, or a
script of any kind. A transaction carrying one is not a transaction with an
undeclared field; it is a transaction doing something this version cannot
describe to a person. A client MUST block, reporting `mint.undeclared` for a
mint or burn and `body.unsupported` for the rest.

**A client MUST refuse to derive effects from a transaction it cannot read
completely.** A body member it does not model is not a member it may skip: the
skipped member is precisely the undeclared effect this section exists to catch,
and an era that adds one MUST reach a client as a refusal rather than as
silence. This obligation is on the decoder, and it is the one place where a
lenient implementation defeats every rule above it.

#### The fee and the client's own adjustments

| Supplied | Rule | Shown to the person as |
|---|---|---|
| the fee | Bounded below by what the protocol parameters require for this transaction, and above by the ceiling below. | a cost |
| a deposit | Exactly the protocol parameter. | a cost that comes back, marked refundable |
| a refund | Exactly the protocol parameter. | a return |
| the raise to an output's minimum | Exactly the ledger's minimum for that output, and never more. | an effect of its own, with its cause |
| change | To `changeAddress`, at an address the wallet controls. | part of the net delta, not a payment |

Nothing declares the fee, so there is nothing to compare it against — but an
unbounded fee is an undeclared payment under another name, and the person pays
it either way. A client MUST block, reporting `fee.excessive`, where the fee
exceeds:

> the minimum fee the protocol parameters require for the transaction as built,
> plus the minimum ADA an output to `changeAddress` would require.

The first term is what this transaction costs to submit. The second is the only
legitimate reason to exceed it: where the remainder after paying everything is
too small to make a change output, it cannot be returned to the person and the
balancer adds it to the fee instead. Beyond that sum, no rule of the ledger
explains the difference.

#### The validity interval

A client MUST convert the body's interval to wall-clock instants and MUST block
where either end is wrong:

- an end later than `validUntil`, reported as `interval.beyond-declared`. The
  obligation not to set one is in [Balancing](#balancing); this is what proves
  it was kept.
- a start later than the current time, reported as `interval.not-yet-valid`. A
  transaction that cannot be submitted yet is one the person cannot act on, and
  nothing in this version has a reason to build one.

The conversion needs the network's slot-to-time mapping, which is why it is one
of the four terms above. A client that assumes a constant slot length will show
an expiry that drifts from the real one, and the person reading "expires in four
minutes" is reading the client's arithmetic, not the ledger's.

### Blocking

A client that finds any mismatch MUST fail with `EFFECTS_MISMATCH`, and MUST NOT
ask the wallet for a signature. The code is terminal in the sense
[Failure responses](#failure-responses) gives the word: this transaction will
not be signed, and no repetition of anything changes that. In particular the
rebuild path — the one [Balancing](#balancing) defines for an expired interval —
MUST NOT be used in answer to a mismatch. Rebuilding until the gate passes is
the same thing as not having a gate.

**There is no override.** No allowlist of publishers, no verified badge that
relaxes the rule, no setting, no confirmation that lets a determined person
through. A mismatch reached that person because the transaction and the
declaration disagree, and no property of the publisher makes them agree. This
document says so rather than leaving it to implementations because the override
is the first thing anyone under commercial pressure asks for, and a protocol
whose central guarantee is optional in practice does not have it.

A client MUST show what was declared, what the transaction does, and which of
the two it refused to reconcile, in plain language, and MUST NOT show the
endpoint's `message` as an alternative account of the same transaction. The
person does not need to be told which rule fired; they need to be able to see
the difference the client saw.

| Reason | Raised when |
|---|---|
| `output.missing` | The body pays fewer outputs to a declared address than the intent declared. |
| `output.undeclared` | The body pays an output the intent did not declare, to an address the wallet does not control, or more outputs to a declared address than were declared. |
| `output.lovelace` | The lovelace the body pays to an address is not the sum of the permitted amounts. |
| `output.assets` | An asset total the body pays to an address is not the total declared. |
| `certificate.missing` | A declared certificate is absent from the body. |
| `certificate.undeclared` | The body carries a certificate the intent did not declare. |
| `certificate.order` | The declared certificates are all present, in an order the intent did not ask for. |
| `certificate.target` | A certificate names a pool or a DRep other than the declared one. |
| `certificate.credential` | A certificate acts on a stake credential the wallet does not control. |
| `withdrawal.missing` | `withdrawRewards` was declared and the body withdraws nothing. |
| `withdrawal.undeclared` | The body withdraws where the intent did not declare it, or withdraws more than once. |
| `withdrawal.account` | A withdrawal names a reward account the wallet does not control. |
| `mint.undeclared` | The body mints or burns. Nothing in this version can declare it. |
| `body.unsupported` | The body carries a member this version cannot describe: a reference input, collateral, a required signer, a vote, a proposal, a donation, or a script. |
| `fee.excessive` | The fee exceeds the minimum for this transaction plus one change output's minimum ADA. |
| `interval.beyond-declared` | The transaction stays valid past `validUntil`. |
| `interval.not-yet-valid` | The transaction cannot be submitted until after the present moment. |

A JSON Schema proves nothing about a comparison, so the cases that separate a
conforming gate from a plausible one are published as behaviour:
[`../examples/effects/verdicts.json`](../examples/effects/verdicts.json) is a
table of declared intents, derived effects and the verdict each pair MUST
produce. An implementation can run it without reading a line of ours.

### Security considerations

A Slip asks a person to sign a transaction that someone else asked for. That is
the risk this protocol introduces, and this section states what answers it: what
each party is trusted for, what an attacker in each position can attempt, and —
as plainly as the rest — what this document does not defend against.

#### What is trusted

| Party | Trusted for | Not trusted for |
|---|---|---|
| the endpoint | nothing | anything at all. Every field it returns is a claim, and the only one this protocol acts on is the intent, which is checked against the transaction rather than believed. |
| the client | everything — it derives the effects, runs the comparison and holds the block | nothing, and there is no way to write this cell honestly. A client an attacker controls has already won, and no rule in this document reaches below it. |
| the wallet | holding the keys, reporting the addresses and the network it is on, and signing what it is given | saying what a transaction does. A wallet renders its own summary; nothing here depends on it. |
| the transport | establishing which origin answered | saying who is behind that origin. See [Publisher identity](#publisher-identity). |

**A client MUST resolve a Slip over `https:`, and MUST refuse any other scheme.**
It MAY additionally admit `http:` on a loopback host, for development, and MUST
NOT admit it anywhere else. Every guarantee in this document rests on knowing
which origin answered; over cleartext there is no answer to that question, and
the intent, the addresses inside it, and the metadata it is judged against are
all rewritable in flight by whoever carries them.

**A client MUST NOT follow a redirect to another origin** — not at
`/slips.json`, not at discovery, not at `POST` — and MUST fail with
`MALFORMED_RESPONSE` where one is returned. A cross-origin redirect is the same
indirection [Linked actions](#linked-actions) forbids in an `href` and
[`slips.json`](#domain-mapping) cannot express, arriving by a third route. A
client MAY follow a same-origin redirect, and MUST bound how many it follows.

**A client MUST NOT execute anything an endpoint returns.** These payloads are
data. `description`, `message` and `reason.message` are plain text and MUST be
rendered as text, as the fields that define them already require; `icon` is an
image. A client that interpreted any of them as markup would be handing every
publisher script execution inside a page that holds a wallet connection.

**A client MUST bound what it reads.** Every array in this protocol has a
maximum length and every string a maximum size, so a conforming response has a
computable ceiling; a non-conforming one does not, and a response body with no
end is a client that never renders anything. A client MUST impose a limit on the
size of a response it will read and on how long it will wait for one, and MUST
report exceeding either as `UNREACHABLE` — nothing usable was received, and the
same request may well succeed later.

#### A malicious endpoint

**In this version the endpoint does not build the transaction; the client
does.** What an endpoint controls is the intent it returns and the words around
it. That narrows what it can attempt, and it does not make the gate optional:
the derivation runs over the bytes the wallet is about to be handed, so it
catches a divergence introduced anywhere between the intent and those bytes —
by the endpoint, by the client's own balancer, by the library underneath it, or
by anything that touched the transaction after it was built. A gate watching
only the endpoint would be watching one of the four.

| An endpoint attempts | What refuses it |
|---|---|
| an output to an address the person never saw | nothing, and nothing should: the client renders every address and amount it derived, and that is the Slip working. |
| a payment the intent does not declare | `output.undeclared`. Every output the body pays is declared or is change to an address the wallet controls. |
| more, or larger, payments to an address it did declare | `output.missing`, `output.undeclared`, `output.lovelace`, `output.assets`. The amounts are exact and the count is exact. |
| a native asset slipped into a declared output | `output.assets`, over base units, against a declaration that cannot state decimals. |
| a delegation to a pool or DRep other than the one shown | `certificate.target`. |
| a certificate the intent never declared — a delegation riding along with a payment | `certificate.undeclared`. |
| a certificate reordered so the ledger applies it differently | `certificate.order`. |
| a declared certificate or withdrawal quietly absent from the transaction that reaches the wallet | `certificate.missing`, `withdrawal.missing`. What was declared has to be there too: a gate watching only for additions would pass a delegation that never delegates. |
| a certificate acting on someone else's stake credential | `certificate.credential`. This version has no field that could name a credential, so there is no claim to fail — only an effect nothing could have declared. |
| a withdrawal the person did not ask for, or from another account | `withdrawal.undeclared`, `withdrawal.account`. |
| a mint, a burn, a script, a vote, a proposal, a donation, collateral, a reference input, a required signer | `mint.undeclared` and `body.unsupported`. This version cannot describe any of them to a person, so a transaction carrying one is blocked rather than rendered. |
| a fee inflated into an undeclared payment | `fee.excessive`, bounded by the protocol parameters plus one change output's minimum ADA. |
| a transaction left submittable for hours, or not submittable yet | `interval.beyond-declared` and `interval.not-yet-valid`, against the `validUntil` rules in [Balancing](#balancing). |

What is left to a malicious endpoint is the one thing no arithmetic reaches: an
intent that is exactly what it declares and still not what the person wanted.
That is why the derived effects are rendered rather than merely computed. This
protocol guarantees that a person is shown what a transaction does before they
sign it. It does not guarantee that what it does is a good idea, and no protocol
can.

**What an endpoint learns.** Discovery is anonymous by construction: the same
bytes go to everyone, credentials are forbidden at both ends, and nothing about
the person takes part. The build request discloses one payment address and a
network — what a counterparty learns from any transaction — and, through the
request itself, whatever the network layer discloses: an address at the IP
layer, a time, a user agent. An `icon` served from the publisher's own host
discloses the same at render time, which is a cost of rendering a card and worth
knowing rather than hiding. What an endpoint never learns is what the wallet
holds; that is [Balancing](#balancing), and in this version there is no request
in which it could ask.

#### Metadata that lies

Two things in this protocol are called metadata and only one of them is
compared.

`title`, `description`, `label` and `message` are sentences a publisher wrote.
Nothing checks them, because nothing can: a schema cannot read a sentence, and
arithmetic cannot contradict one. The intent is the declaration — a shape whose
every field is an integer count, an address, a pool id or a DRep id — and it is
what the transaction is held to.

Three rules follow, and each is stated where it belongs; they are gathered here
because they only work together:

- A client MUST render the effects it derived, and MUST NOT render the
  publisher's words in their place or present them as a summary of the
  transaction ([Deriving the effects](#deriving-the-effects)).
- Any mismatch hard-blocks the signature, with no override, no allowlist and no
  confirmation that lets a determined person through ([Blocking](#blocking)).
- A mismatch MUST NOT be answered by rebuilding. An endpoint that returns a
  different intent to every `POST` cannot grind its way past the gate, because
  each transaction is compared against the intent it was built from
  ([Blocking](#blocking)).

The last one is the one an implementation gets wrong by being helpful. A retry
that eventually succeeds is indistinguishable, from the person's side, from a
transaction that was fine all along.

#### Replay

Four different things can be replayed here and they have four different answers.

**The link is meant to be replayed.** It is public, it is reshared, and every
person who opens it gets their own intent built against their own unspent
outputs. A Slip URL therefore has to survive being reshared, and a publisher
MUST NOT place a secret in one: everything in the path and the query reaches
every reader, every link unfurler, every referrer log and every browser
history. An endpoint
MUST NOT authenticate by anything a client is forbidden to send either — a
client sends no cookies and no `Authorization` header at any step, so an
endpoint that authorises by one is unusable rather than protected.

**A partial intent replays harmlessly.** It names no inputs, carries no
signature and commits nothing; anyone who obtains one and acts on it spends
their own funds. This is why `INTENT_EXPIRED` is transient and why the rebuild
path is a fresh `POST` rather than a stored artefact.

**An unsigned transaction is not a bearer instrument.** It spends specific
inputs of one wallet, and nobody without that wallet's keys can complete it.

**A signed transaction is.** Once submitted it cannot be replayed — the ledger
consumes its inputs, and on an eUTxO ledger the input set is the anti-replay
device this protocol does not have to invent. The exposure is the interval
before submission: a signed transaction that has not been submitted may be
submitted by anyone who obtains it, at any moment until its validity interval
ends, and the person who signed it cannot recall it — they can only spend one of
its inputs first. That is what the interval rules are for. A client MUST NOT set
an interval ending after `validUntil` and SHOULD set a shorter one; it MUST NOT
ask for a signature over an interval that has already expired; and it MUST NOT
retain a signed transaction beyond the submission it was signed for.

#### Origin spoofing

**The origin is the only identity this protocol establishes on its own.**
Everything in a Slip stays on it: a linked action's `href` must resolve there, a
`slips.json` rule cannot name another host, and a redirect may not leave it. So
the party a person is dealing with when they act on a Slip is the origin the
link is on, and **a client MUST show that origin where the person can see it at
the moment they act** — not only in a place they would have to go looking.

**A client MUST NOT render a publisher-supplied string in place of the origin.**
`title` may claim any name at all; it is the attacker's own field, and a client
that displays it as the source of a Slip has let the attacker write the answer
to the only question the transport settled.

**A link preview is not evidence.** The card an unfurler renders is built from
`title`, `description` and `icon` — publisher-controlled fields, fetched by
machines that never run the comparison and never see a transaction. A preview
shows what a publisher said, and this document treats it that way everywhere.

What none of this answers is *which* origin. `linktap.example` and a lookalike
registered an hour ago are both origins serving honest Slips that pay their own
addresses, and no derivation can separate them: the transaction really does pay
the address the intent declared. [CIP-13]'s security considerations raise this
as the hijacked link; the structural half of the answer is above, and the rest
is the person recognising a name. A client SHOULD render domain names in the
form its platform judges safe — the treatment browsers already give
internationalised names — and what remains after that is the gap the identity
layer exists to narrow.

#### Server-balanced builds, and what they disclose

Version 1 keeps the wallet's unspent outputs away from the endpoint
structurally, not as a policy: the build request is a closed object of two
fields, an endpoint MUST reject a body carrying any other member, and there is
no shape in this version through which a UTxO set could travel.
`build: "server"` names the mode where that changes, and reserves it without
defining it.

What the mode discloses is not one more field. A wallet's unspent output set is
a picture of everything the person holds — every asset, every quantity, and,
through the addresses that hold them, which of those holdings belong together —
handed to a party this protocol assumes is dishonest, kept for as long as they
like, and impossible to withdraw afterwards. A signature can be refused after
the fact. A disclosure cannot.

Two requirements therefore bind now, before the mode exists:

- **An endpoint that balances server-side MUST declare `build: "server"` in its
  discovery response**, and an endpoint MUST NOT ask for a wallet's unspent
  outputs under any other declaration. The declaration is what makes the
  disclosure visible before it happens, and it is read by a client that has not
  agreed to it.
- **A client MUST NOT disclose the wallet's unspent outputs without first
  telling the person what is disclosed and to whom, and obtaining their
  agreement for that endpoint on that occasion.** The agreement MUST NOT be
  remembered as a default, and MUST NOT be inferred from an agreement given to
  another publisher. A version 1 client satisfies this by refusing entirely: it
  MUST NOT `POST` to a Slip declaring `build: "server"` and MUST fail with
  `UNSUPPORTED_BUILD_MODE`, which is the strongest form the warning can take.

Nothing about the mode touches [The comparison](#the-comparison). A
server-balanced transaction faces the same derivation and the same block, and
every rule there applies unchanged — an endpoint that selected the inputs still
cannot pay a stranger, inflate a fee or mint an asset without being refused.
What changes is only what the endpoint was told before it built, and that is
precisely the part no later check can undo.

#### Publisher identity

The comparison proves what a transaction does. It says nothing about who
published the link, and the two questions are independent: a transaction whose
effects match its declaration exactly may still come from someone the person
would not have dealt with had they known who they were.

Without any identity mechanism, what a person has is the origin, rendered under
the rules above. That is a real claim and a weak one — it proves someone
controls a domain, not who they are.

A publisher MAY bind that origin to an attested identity. [CIP-170] is the
mechanism this proposal expects: a KERI attestation anchors a digest of a
publisher's own document in the issuer's key event log and publishes a reference
to it in transaction metadata under label `170`, and through an ACDC credential
chain the identifier resolves to a legally recognised entity, valid only within
the window the attestation states. What CIP-170 does not supply is the half a
client needs first — it anchors a digest of arbitrary data, so it defines no
publisher payload, and it answers no question of the form "given this origin,
which identifier should I trust". A binding from an origin to an identifier has
to be specified next to it, and the ecosystem's existing pattern for a runtime
trust anchor is an origin-anchored document under `/.well-known/`, as
[CIP-186] uses.

**This version defines neither that payload nor its resolution.** What it fixes
is how such a layer may behave, because the shape of the mistake is already
visible:

- **An attestation MUST NOT relax any rule in [The
  comparison](#the-comparison).** No attested publisher, at any level of
  assurance, gets a widened tolerance, a skipped check, or a way through a
  block. An identity that can relax the gate is an allowlist, and an allowlist
  is the registry this protocol exists in order not to need.
- **A failure to resolve an attestation MUST NOT block a Slip, and MUST NOT
  render as verified.** Absent, malformed, expired, revoked and valid are five
  different states; only the last is verified, and a client MUST NOT resolve an
  ambiguity in favour of it.
- **A client MUST NOT require an attestation in order to render a Slip.** Most
  publishers will have none, and a protocol that renders only attested ones has
  chosen the registry by another route.
- **An attestation is rendered alongside the origin, never in place of the
  derived effects.** Knowing who is asking does not tell a person what they are
  signing, and the moment a badge starts standing in for the arithmetic, the
  badge is what an attacker buys.

The two mechanisms answer different halves and neither substitutes for the
other. Effects without identity leaves a person approving a transaction they can
read from a party they cannot; identity without effects is a list of parties
whose transactions nobody checks.

#### What this document does not defend against

- **A person persuaded to sign a transaction that does exactly what it says.**
  The gate proves the transaction matches the declaration. Nothing here says the
  declaration is a good idea, and an honest Slip paying an attacker's address is
  an honest Slip.
- **A compromised client.** The derivation, the comparison and the block all run
  in the client. Where that is the attacker's code, nothing in this document
  reaches below it. How a client is delivered and kept intact is a property of
  that client, not of this protocol.
- **A compromised or hostile wallet.** It holds the keys, and it reports the
  addresses the derivation treats as the person's own.
- **Key theft, malware, and a person who approves a connection to a page they
  should not have opened.** All of these precede the first `GET`.
- **A publisher who takes payment and does not deliver.** This protocol makes a
  payment legible before it is signed. It does not make the counterparty
  trustworthy, and it has no dispute, refund or escrow mechanism — nothing here
  ever holds anyone's funds.
- **A lookalike domain**, to the extent the person does not read the origin. See
  [Origin spoofing](#origin-spoofing) and [Publisher
  identity](#publisher-identity).

### Failure responses

A request that cannot be answered fails with a non-2xx status and a body of the
shape defined here.

This is not the same thing as an action that cannot be used. `disabled` and its
`reason` describe a Slip that was served successfully and currently offers
nothing to sign; a failure response says the exchange itself did not happen. The
body's discriminator is `"error"` for that reason, and this document says
*failure* throughout to keep the two apart in writing.

An endpoint MUST NOT report at `POST` a state it could have reported at `GET`.
Where the state genuinely changed between the two — the last seat was taken, a
deadline passed — the codes below carry it, and a client meeting one MUST
re-fetch discovery, so that the person is shown the same closed card everyone
else can now see rather than a failure private to them.

| Field | Required | Type | Rule |
|---|---|---|---|
| `type` | yes | string | MUST be `"error"`. Discriminates a failure from the shapes `GET` and `POST` return on success. |
| `version` | yes | string | The major version of this protocol the endpoint speaks, under the same rule as discovery. Present on the failure path so that a client which cannot read a response can still learn what it was. |
| `code` | yes | string | One of the codes in the table below. Names what a client does next, not what went wrong inside the endpoint. |
| `message` | yes | string | Plain text addressed to the person, 1–300 characters. MUST NOT contain markup; a client MUST render it as text. MUST NOT carry internal detail — no stack traces, no query text, no upstream URLs, no identifiers of the publisher's own systems. |
| `field` | no | string | The `name` of the parameter at fault, so a client can attach `message` to the field that caused it. Valid only alongside `code: "INVALID_PARAMETER"`. |

A client MUST reject a failure body carrying a member not defined above, for the
same reason it rejects one in discovery.

A failure response MUST set `Content-Type` to `application/json` and MUST set
`Access-Control-Allow-Origin: *`. A client executes on an origin the publisher
does not control, and without that header on the failure path the browser
withholds the body: every failure then reaches the person as an unexplained one,
including the failures they could have corrected themselves. A failure response
MUST NOT be cached, and SHOULD set `Cache-Control: no-store`.

**The classes.** Every code belongs to one of three classes, and the class is
what a client acts on. The class is a property of the code, fixed by this
document, and is deliberately not a field: an endpoint able to declare its own
failure retryable is an endpoint able to keep a client asking.

| Code | Class | Status | Raised by | Rule |
|---|---|---|---|---|
| `INVALID_PARAMETER` | request | 400 | endpoint | A submitted value was rejected. `field` names it where a single parameter is at fault. |
| `WRONG_NETWORK` | request | 400 | endpoint, client | The Slip's `network` and the connected wallet's network do not agree. |
| `INSUFFICIENT_FUNDS` | request | — | client | The wallet's unspent outputs cannot cover the intent, the minimum ADA its outputs require, and the fee. |
| `NOT_FOUND` | terminal | 404 | endpoint | Nothing at this URL describes a Slip. |
| `UNAVAILABLE` | terminal | 409 | endpoint | The action is closed for now, and may open again. |
| `EXPIRED` | terminal | 410 | endpoint | The Slip had a deadline and it has passed. This is permanent. |
| `MALFORMED_RESPONSE` | terminal | — | client | A response arrived that this protocol cannot read. |
| `UNSUPPORTED_VERSION` | terminal | — | client | The response is in a major version this client does not implement. |
| `UNSUPPORTED_BUILD_MODE` | terminal | — | client | The Slip declares a `build` mode this client does not implement. |
| `CANNOT_BALANCE` | terminal | — | client | The intent cannot be built into a valid transaction, for a reason other than funds. |
| `EFFECTS_MISMATCH` | terminal | — | client | The effects derived from the transaction contradict the intent the endpoint declared. |
| `RATE_LIMITED` | transient | 429 | endpoint | The endpoint is deliberately refusing for now. `Retry-After` SHOULD be set. |
| `UPSTREAM_FAILURE` | transient | 502 | endpoint | A service the endpoint depends on failed. |
| `INTERNAL_ERROR` | transient | 500 | endpoint | The endpoint failed and cannot say more than that. |
| `INTENT_EXPIRED` | transient | — | client | A partial intent's `validUntil` has passed. A fresh `POST` returns a fresh one. |
| `UNREACHABLE` | transient | — | client | No usable response: DNS, TLS, a timeout, or a cross-origin request the browser refused. |

An endpoint MUST send each code with the status paired with it above, and MUST
NOT send a code the table marks as raised only by a client. Those carry no
status because nothing usable was received: they name a failure of the exchange
itself, and they exist so that a client renders every failure through one
vocabulary rather than showing the publisher's words for one half of them and a
browser exception for the other. `WRONG_NETWORK` is raised by both, because the
same disagreement is observable at two points — by a client before it sends, and
by an endpoint reading `network` out of what arrived.

What each class obliges of a client:

- **request** — the person or the client can act. A client MUST return to the
  state the request was made from with `message` shown against `field` where one
  is given, and MUST NOT retry the identical request.
- **terminal** — this Slip will not produce a transaction, and repeating the
  request cannot change that. A client MUST stop and MUST render `message`.
- **transient** — the same request may succeed later. A client MAY retry, and
  before each attempt MUST wait at least the interval given by `Retry-After`, or
  at least one second where none is given. Successive intervals MUST increase,
  and the attempts MUST be bounded. `Retry-After` is only a SHOULD on the
  endpoint, so without a floor and a growing interval the polite path and the
  one that hammers a struggling publisher are the same code. Retrying is
  otherwise safe by construction: a `POST` returns a transaction and signs
  nothing, so no retry can duplicate an on-chain effect.

Two schemas govern this body, and they bind different parties. An endpoint
conforms to [`slip-error-response-endpoint.schema.json`](./schemas/slip-error-response-endpoint.schema.json),
which admits only the codes marked `endpoint` above. A client validates against
[`slip-error-response.schema.json`](./schemas/slip-error-response.schema.json),
which constrains `code` to the shape of a code and not to that list. A client
able to read only the codes it already knows would discard a publisher's
`message` over a value it could have rendered, and would report a condition this
document defines as an unreadable response.

A client MUST classify a failure by the first of these that applies:

1. A body that is not JSON, or that does not satisfy the client schema, is not a
   failure response at all. The client MUST classify by status alone — `429` and
   `5xx` as transient, every other status as terminal — and MUST NOT render any
   part of it. An unparsed body is as likely to be an intermediary's HTML error
   page as it is the publisher's words.
2. A body that satisfies the client schema but carries a `code` this document
   does not define is terminal, and the client MUST render its `message`. The
   other two classes each authorise the client to act again, by retrying or by
   resubmitting a corrected request, and neither is safe to do on a failure whose
   meaning is unknown. A disagreeing status MUST NOT override this: an
   uninterpretable code arriving with a status that says to try again is the one
   combination that could hold a client in a loop it cannot reason about.
3. Otherwise the client MUST classify by `code`, and MUST ignore a status that
   contradicts it.

A code this document does not define means a non-conforming endpoint, not a
newer one. A response from a later major version never reaches this rule,
because the version check precedes it — see [Protocol
versioning](#protocol-versioning).

Conditions arising after a transaction exists — a refused signature, a rejected
submission — are named where those steps are specified. They are client
conditions in this same vocabulary and never travel over HTTP, and so is
`EFFECTS_MISMATCH`: the rules that raise it are in
[The comparison](#the-comparison), and the reason it can never be answered by
retrying is in [Blocking](#blocking).

```json
{
  "type": "error",
  "version": "1",
  "code": "INVALID_PARAMETER",
  "message": "Amount must be between 1 and 500 USDM.",
  "field": "amount"
}
```

```json
{
  "type": "error",
  "version": "1",
  "code": "EXPIRED",
  "message": "This campaign closed on 12 August. Nothing can be signed from this link."
}
```

### Protocol versioning

`version` carries a major version and nothing else. Discovery responses, the
partial intents `POST` returns, and failure bodies all carry the same value, and
it is the only compatibility signal in this protocol: a client MUST NOT infer
what an endpoint supports from the presence or absence of any field.

There are no minor versions, because there is nothing left for one to describe.
A client MUST reject a response carrying an undefined member, so a field cannot
be added to a shape compatibly, and a change that cannot be ignored is not a
minor change. Every change to a shape is therefore a new major version, and the
number stays a single integer.

**These are the shapes version 1 defines, and there are no others.** Every
payload this protocol carries is one of them, and each is governed by a schema
under [`schemas/`](./schemas):

| Shape | Specified in | Schema |
|---|---|---|
| the domain mapping | [Domain mapping](#domain-mapping) | [`slips-json.schema.json`](./schemas/slips-json.schema.json) |
| the discovery response | [The discovery response](#the-discovery-response) | [`slip-get-response.schema.json`](./schemas/slip-get-response.schema.json) |
| the build request | [Building the transaction](#building-the-transaction) | [`slip-post-request.schema.json`](./schemas/slip-post-request.schema.json) |
| the partial intent | [The partial intent](#the-partial-intent) | [`slip-partial-intent.schema.json`](./schemas/slip-partial-intent.schema.json) |
| a failure, as an endpoint may send it | [Failure responses](#failure-responses) | [`slip-error-response-endpoint.schema.json`](./schemas/slip-error-response-endpoint.schema.json) |
| a failure, as a client must read it | [Failure responses](#failure-responses) | [`slip-error-response.schema.json`](./schemas/slip-error-response.schema.json) |

Six vocabularies are closed alongside them, and each is closed in the same
sense: a value outside it is not an extension but a payload a conforming
implementation rejects. They are the networks, the parameter types, the
certificate types, the build modes, the [failure codes](#failure-responses),
and the [reasons a client reports a block](#blocking).

Adding a field, removing one, widening a vocabulary, or changing what any of
them means is version 2. There is no compatible change to make here, and that
is the trade this document took deliberately: a client rejects what it does not
recognise, so nothing can be slipped into a shape between versions — and an
effect that reached a person through a field their client did not model is the
one failure this whole protocol exists to prevent.

**One URL speaks one major version.** There is no negotiation. A client sends no
version, and an endpoint MUST NOT vary the response body by request header:
discovery is required to return the same bytes to every requester, and a
response that turns on a header is neither cacheable nor the same document a
link unfurler fetched. A publisher supporting two major versions publishes one
URL per version, exactly as it already publishes one URL per network.

**A client MUST read `version` before validating the rest of a response.** A
response in a later major version may satisfy this document's schema while
meaning something else, or fail it over a field that version defines; reporting
a malformed response in either case tells the person the wrong thing about a
working endpoint.

Where `version` is not a major version the client implements, the client MUST
fail with `UNSUPPORTED_VERSION`, MUST NOT render any part of the response as
something that can be acted on, and MUST NOT `POST`. Rendering the fields it
happens to recognise, from a response it has admitted it does not understand, is
precisely the gap between what is shown and what is signed that this protocol
exists to close.

## Rationale: How does this CIP achieve its goals?

This proposal makes one claim: a person can be shown what a transaction does
before they sign it, without trusting whoever published the link that produced
it. Every decision below follows from that claim, and each is stated with the
cost it carries — the ones that were expensive are the ones worth recording.

### Why derived effects replace a registry of publishers

A protocol where a third party builds the transaction has to answer how the
person knows what they are signing. There are only two answers. Either the
client establishes **who** published the link, or it establishes **what** the
transaction does.

Establishing who takes the shape of a list: an allowlist of approved endpoints,
a verified badge, a review queue, a client that warns on anything outside it.
Every version of it has the same three properties. Someone has to run it, which
makes the protocol depend on a party that can stop paying for it. Someone has to
be turned down by it, which makes permission the default and a public good into
a gate. And it answers the wrong question anyway: an approved publisher who
changes one line of their endpoint is still approved, and the list has no way to
notice.

Establishing what is available here in a way it is not on every ledger. An
eUTxO transaction names its inputs, its outputs, its fee, its certificates, its
withdrawals, its mint and its validity interval, and the ledger's rules are
deterministic — the transaction that will be submitted is the transaction that
was built, and its effects are fixed before it is signed rather than settled by
the state it meets on arrival. Deriving them is arithmetic over the body, not a
simulation of it, and arithmetic needs no permission from anybody.

So the client derives, compares against what the endpoint declared, and blocks
where the two disagree. What that buys is the thing a registry cannot: the
guarantee holds for a publisher nobody has ever heard of, on their first day,
with no application to make and nobody to approve them — and it holds against a
publisher who was approved and has since changed their mind.

The cost is a real one and it is paid by clients. A conforming client must
decode a transaction body completely, model every member an era defines, and
refuse the ones it cannot read; a lenient decoder defeats every rule in [The
comparison](#the-comparison), because the member it skipped is exactly the
undeclared effect. That obligation is why this document says so much about
decoding and so little about trust.

### Why the client balances, and the endpoint never sees a UTxO

Balancing a transaction requires the wallet's unspent outputs. Whoever balances
therefore holds them, and that single fact decided the shape of the build
request.

A UTxO set is not one more field of telemetry. It is every asset the person
holds, every quantity, and — through the addresses holding them — which of those
holdings belong together, handed to a party this document assumes is dishonest
and cannot be recovered afterwards. A signature can be refused after the fact; a
disclosure cannot.

So version 1 balances in the client, and the build request is a closed object of
two fields with no shape through which a UTxO set could travel. The property is
structural rather than promised, which is the only form of it worth having: an
endpoint cannot ask, a client cannot answer, and a conforming implementation of
either has nowhere to put the data.

Three costs come with it, and all three are accepted. A client has to carry
transaction-building code, which is more than a link handler would otherwise
need. A publisher cannot express an intent that depends on selecting particular
inputs, which is most script-driven work. And a publisher cannot subsidise a
fee, because the transaction is assembled on the other side of the wire.

`build: "server"` names the mode where that changes and reserves it without
defining it, so that the disclosure is declared before it happens and a client
that has not agreed to it can refuse — which a version 1 client does, with
`UNSUPPORTED_BUILD_MODE`.

### Why the intent is the declaration, and the words never are

The obvious design compares the transaction against the metadata the card
showed. It cannot be done. A `title`, a `description` and a `message` are
sentences a publisher wrote; a schema cannot read a sentence and arithmetic
cannot contradict one, and a comparison that pretends otherwise is a check that
passes whatever the words say.

What `POST` returns is therefore a shape whose every field is an integer count
of base units, an address, a pool id or a DRep id — a declaration in the same
terms as the thing derived from the transaction. The words are still rendered,
still bounded, still plain text. They are just never what the transaction is
held to, and [Metadata that lies](#metadata-that-lies) says so where a reviewer
will look for it.

The same reasoning removed every field an endpoint could have stated and the
ledger determines anyway: the fee, a deposit, a refund, a stake credential, a
reward balance. A declared value that is right is redundant; one that is wrong
is a figure shown to a person who had no way to check it. Not having the field
is stronger than validating it.

### Why the comparison admits no tolerance

Both sides are integer counts of base units, so a margin is not an engineering
allowance — it is a budget, and an attacker who works inside it is inside every
transaction this protocol carries. The margins that get proposed, a few lovelace
or a percent of the fee, are worth more than most of the payments in scope.

What a tolerance is usually reaching for is the fee, the ledger's minimum ADA on
an output, and a deposit — three quantities the endpoint genuinely cannot
predict. Each is answered as an exact value with a stated cause rather than as
slack: the raise to an output's minimum is computed, a deposit is a protocol
parameter, and the fee is bounded by the minimum for the transaction as built
plus one change output's minimum ADA, which is the only reason a balancer
legitimately exceeds the minimum. The result is a comparison that is strict
everywhere and still describes real transactions.

### Why a client rejects what it does not recognise

Every shape here forbids undeclared members, and this document has no minor
versions as a consequence. That is not tidiness. A protocol that ignores
unknown fields is a protocol in which a field can carry an effect no comparison
covers, to a client that renders everything around it and never mentions it —
which is the whole failure, arriving through the extension mechanism rather than
around it.

The price is that every change costs a major version and one URL speaks one
version. A publisher supporting two publishes two URLs, exactly as they already
publish one per network. That is a real burden on publishers, taken knowingly in
exchange for a client that can never be handed something it will silently pass
over.

### Where this sits among the existing proposals

| Proposal | Standing | Relationship |
|---|---|---|
| [CIP-13] | Proposed since 2020, `Implementors: N/A` | Defines the scheme this registers an authority under. Its security considerations name the hijacked link; the origin rules and the ban on cross-origin `href`, mapping and redirect are the answer. |
| [CPS-16] | Open problem statement | This proposal answers its third open question and registers a unique authority as it requires. |
| [CIP-99] | Active, five wallet implementors | The precedent. A wallet already `POST`s to a project's server from a link and reads a structured JSON reply — that shape is accepted. What CIP-99 does not do is return a transaction the person authorises: its server builds, signs, submits and pays. This adds exactly that, and takes CIP-99's route to Active with it. |
| [CIP-157] | Open PR since 2024-06 | A static payment shape fixed in the URI. Not extended: attaching arbitrary intents to four query parameters inherits the stall without gaining anything, and CPS-16 prefers a discrete CIP. |
| [CIP-158] | Active, implemented | The grammar of `//slip` is CIP-158's, unchanged. It is also the mobile entry point that needs nothing from this proposal: `//browse` lands a link in the wallet's in-app browser, where CIP-30 is injected and this flow runs as it does on a desktop. |
| [CIP-186] | Merged, three converging implementations | The transport a native mobile client would use. It cannot carry a hosted page — its source-app check requires an installed app with a bundle id — so it is a future client of this protocol, not a competitor. Its commit binding over the transaction body and its append-only witness merge are patterns worth following. |
| [CIP-170] | Proposed | The identity half. It anchors a digest and resolves an identifier; it defines no publisher payload and no origin-to-identifier binding, so this document specifies how such a layer may behave rather than pretending it exists. |
| CIP-30 | The interface wallets already expose | The whole of what this protocol asks of a wallet: report the network and the addresses, sign a body, return a witness set. No wallet has to change for a conforming client to work. |

### How this answers CPS-16

CPS-16 asks what new authorities or protocols could be built on Cardano URIs,
and observes that each existing one fixes a single transaction shape in the URI
itself. The pattern it describes is the cost: every new kind of shareable
action is a new CIP and a new round of persuading each wallet separately, and
the support matrices for the authorities that took that route show what it
yields.

This proposal is the general case of that pattern. One authority, one endpoint
contract, and the transaction's shape carried in a response rather than in the
URI — so a new kind of Slip is a publisher writing an endpoint, not an
ecosystem writing a standard. The reason it can be general and still safe is
that the client checks the transaction rather than the URI, which is the part
CPS-16's existing extensions get for free by having no room to lie in.

### Future work

Everything below was considered and deliberately left out of version 1. Each is
recorded with what it would cost, because a reader's fair question about an
absent feature is whether it was missed or refused.

- **Server-balanced builds.** `build: "server"` is reserved and undefined. What
  is missing is the request shape, and the consent rule that must bind before
  one exists: a client discloses a UTxO set only after telling the person what
  is disclosed and to whom, per endpoint, per occasion, never remembered. Both
  requirements are already normative in [Server-balanced builds, and what they
  disclose](#server-balanced-builds-and-what-they-disclose).
- **Publisher identity.** [CIP-170] supplies attestation and leaves the half a
  client needs first — a publisher payload, and a binding from an origin to an
  identifier. The ecosystem's existing pattern for a runtime trust anchor is an
  origin-anchored document under `/.well-known/`. The four rules such a layer
  must obey are fixed in [Publisher identity](#publisher-identity), and the
  first of them is that it may never relax the comparison.
- **Script actions, and required signers with them.** A transaction spending
  from a script address, minting, or carrying a script certificate can express
  intents this version cannot, and required signers become meaningful the moment
  something can read them. Both need declaration shapes, and the comparison
  needs rules for effects a script produces. A new major version.
- **Mint and burn.** Version 1 blocks them rather than describing them, because
  a mint declared in terms a person can check is a shape nobody has written yet.
- **Parameter types carrying Cardano validation** — an address, an asset amount
  with its decimals. Absent because their validation rules would be specified
  before an implementation exists to check them against, and a wrong rule about
  decimals is the most expensive kind in this family.
- **Asset display decimals.** Deliberately unavailable to a publisher, and the
  reason is in [The partial intent](#the-partial-intent). Resolving them from
  on-chain metadata is a client concern and belongs in a client's own
  specification, never in a field an endpoint fills.
- **A CIP-186 transport.** A native mobile client would reach a wallet through
  CIP-186 rather than CIP-30. Nothing in this document prevents it; the
  derivation and the comparison are transport-independent, and the work is a
  client's, not this protocol's.
- **Fee subsidy.** A publisher cannot pay a person's fee in a client-balanced
  transaction. Whether a version could, without handing the endpoint the input
  selection, is genuinely open.

## Path to Active

### Acceptance Criteria

- [ ] **Two independent implementations of the comparison** produce the verdict
      this document requires for every case in
      [`../examples/effects/verdicts.json`](../examples/effects/verdicts.json),
      including every case that MUST block. Independent means written from this
      document rather than from each other's code.
- [ ] **A conforming client and a conforming Slip endpoint**, both open source
      under an OSI-approved licence, each passing every payload in
      [`../examples/`](../examples): every `valid/` accepted, every `invalid/`
      rejected, every `invalid/rule/` rejected after it has passed its schema.
- [ ] **At least two publishers unaffiliated with the authors** operate a Slip
      endpoint on mainnet, and their Slips complete end to end from a shared
      link.
- [ ] **The full flow — discovery, build, balance, derive, compare, sign,
      submit — verified against at least three CIP-30 wallets on mainnet,
      requiring no change to any of them**, with the results published per
      wallet and per version.
- [ ] **A published set of attack transactions, every one blocked**, and a
      report saying so. The set is permanent and grows: any transaction that
      should have been blocked and was not becomes a case in it.
- [ ] **The `//slip` authority registered** in CPS-16's list of authorities.
      Registration is a list entry, not an implementation, and nothing else
      here depends on it.

**No criterion above asks a wallet to implement a URI authority, and none may
be added that does.** That is a deliberate constraint rather than an oversight,
and the record it is drawn from is specific: [CIP-13] has been `Status:
Proposed` with `Implementors: N/A` since 2020, [CIP-157] has been an open pull
request since June 2024, and a third authority proposal was closed by the
editors in May 2026 after two years without a specification. In every case the
work was finished and the criterion that was never met was somebody else's
adoption.

Everything above is instead met by the parties who have a reason to act: the
publishers who want to be paid, the client that renders the Slip, and the
implementers who can run the examples without asking anyone's permission.
Wallets appear once, as the thing the client is verified against — through
CIP-30, which they already expose, and which no conforming client asks them to
change.

### Implementation Plan

- [ ] **Reference implementations**, published to npm under an OSI-approved
      licence and versioned together: the schemas and link resolution, the
      derivation and comparison engine, an endpoint framework, and a client.
      The comparison engine is the one that matters — it is what an implementer
      checks their own against.
- [ ] **The conformance examples published with this CIP**, runnable by an
      implementation that has read none of our code. They are already in
      [`../examples/`](../examples) with a directory per shape and a stated
      reason for every rejection case.
- [ ] **A hosted client and a self-hostable one**, so that a publisher who wants
      to run nothing still has a working Slip and a publisher who wants to run
      everything can.
- [ ] **A reference integration on mainnet** — a stablecoin payment Slip behind
      a human URL, on preprod first — as the concrete use case [CIP-99] had and
      [CIP-157] did not.
- [ ] **A wallet co-author**, sought through the CPS-16 discussion and the
      editors' wallet contact list. This is the ingredient CIP-99 had and every
      stalled URI proposal lacked. It is in the plan and not in the criteria,
      because it is the one item no amount of our own work can guarantee.
- [ ] **This CIP submitted after the implementation runs on mainnet**,
      documenting behaviour that already works rather than behaviour that is
      intended. Deltas found between the two are reconciled in the text before
      submission.

## Copyright

This CIP is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode).

[CIP-13]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0013
[CIP-99]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0099
[CIP-158]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0158
[CPS-16]: https://github.com/cardano-foundation/CIPs/tree/master/CPS-0016
[RFC 2119]: https://www.rfc-editor.org/rfc/rfc2119
[RFC 8174]: https://www.rfc-editor.org/rfc/rfc8174
[RFC 3986]: https://www.rfc-editor.org/rfc/rfc3986
[RFC 3339]: https://www.rfc-editor.org/rfc/rfc3339
[CIP-19]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0019
[CIP-129]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0129
[CIP-170]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0170
[CIP-186]: https://github.com/cardano-foundation/CIPs/tree/master/CIP-0186
